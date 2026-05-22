import { randomUUID } from 'crypto'
import { deriveKey, deriveRoomKey, hashPassword } from './crypto'
import { JoinRoomPayload, LeaveRoomPayload, PeerInfo, ProtocolMessage, RoomClosedPayload, RoomInfo, RoomMembersPayload } from './protocol'
import { ChatMessage, LocalPeer, Room } from './types'

interface PendingJoin {
  name: string
  type: 'public' | 'private'
  password?: string
}

export interface RoomServiceDeps {
  local: LocalPeer
  getPeers: () => PeerInfo[]
  sendDirect: (peerId: string, msg: ProtocolMessage) => void
  broadcastToRoom: (roomId: string, msg: ProtocolMessage, excludePeerId?: string) => void
  onLocalRoomsChanged: () => void
  onJoinRejected: (info: { roomId: string; reason: string }) => void
  onRoomJoined?: (roomId: string) => void
}

export class RoomService {
  private rooms = new Map<string, Room>()
  private pendingJoins = new Map<string, PendingJoin>()

  constructor(private deps: RoomServiceDeps) {}

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  getAll(): Room[] {
    return Array.from(this.rooms.values())
  }

  getLocalRoomList(): RoomInfo[] {
    return Array.from(this.rooms.values()).map((r) => ({
      roomId: r.roomId,
      name: r.name,
      type: r.type,
      memberCount: r.members.size,
    }))
  }

  isJoinPending(roomId: string): boolean {
    return this.pendingJoins.has(roomId)
  }

  createRoom(name: string, type: 'public' | 'private', password?: string): Room | null {
    if (type === 'private' && !password?.trim()) {
      return null
    }

    const roomId = randomUUID()
    const room: Room = {
      roomId,
      name,
      type,
      members: new Set([this.deps.local.peerId]),
      messages: [],
    }
    if (type === 'private' && password) {
      room.passwordHash = hashPassword(password)
      room.encryptionKey = deriveKey(password, roomId)
    } else {
      room.encryptionKey = deriveRoomKey(roomId)
    }
    this.rooms.set(roomId, room)
    this.deps.onLocalRoomsChanged()
    return room
  }

  joinRoom(roomId: string, password?: string, name?: string, type?: 'public' | 'private') {
    const room = this.rooms.get(roomId)
    if (room) {
      room.members.add(this.deps.local.peerId)
      if (room.type === 'private' && password) {
        if (!room.encryptionKey) {
          room.encryptionKey = deriveKey(password, roomId)
        }
        if (!room.passwordHash) {
          room.passwordHash = hashPassword(password)
        }
      }
      this.deps.onLocalRoomsChanged()
      this.deps.onRoomJoined?.(roomId)
      return
    }

    for (const peer of this.deps.getPeers()) {
      if (peer.rooms.some((r) => r.roomId === roomId)) {
        this.pendingJoins.set(roomId, {
          name: name || 'Unknown',
          type: type || 'public',
          password: type === 'private' ? password : undefined,
        })

        const payload: JoinRoomPayload = { roomId }
        if (password) {
          payload.passwordHash = hashPassword(password)
        }
        this.deps.sendDirect(peer.peerId, {
          type: 'join_room',
          peerId: this.deps.local.peerId,
          nickname: this.deps.local.nickname,
          timestamp: Date.now(),
          payload,
        })
        return
      }
    }
  }

  handleJoinRoom(fromPeerId: string, fromNickname: string, payload: JoinRoomPayload): boolean {
    const room = this.rooms.get(payload.roomId)
    if (!room) return false

    if (room.type === 'private') {
      const hash = payload.passwordHash ?? ''
      if (!room.passwordHash || hash !== room.passwordHash) {
        this.deps.sendDirect(fromPeerId, {
          type: 'leave_room',
          peerId: this.deps.local.peerId,
          nickname: this.deps.local.nickname,
          timestamp: Date.now(),
          payload: { roomId: payload.roomId, reason: 'wrong_password' },
        })
        return false
      }
    }

    if (!room.members.has(fromPeerId)) {
      room.members.add(fromPeerId)
      this.appendSystemMessage(payload.roomId, `${fromNickname}님이 참여하였습니다.`)
      this.deps.onLocalRoomsChanged()
    }
    this.deps.broadcastToRoom(payload.roomId, {
      type: 'room_members',
      peerId: this.deps.local.peerId,
      nickname: this.deps.local.nickname,
      timestamp: Date.now(),
      payload: {
        roomId: payload.roomId,
        members: Array.from(room.members),
        name: room.name,
        type: room.type,
      } as RoomMembersPayload,
    })
    return true
  }

  handleLeaveRoom(payload: LeaveRoomPayload, fromPeerId?: string, fromNickname?: string) {
    if (payload.reason === 'wrong_password') {
      this.pendingJoins.delete(payload.roomId)
      if (this.rooms.has(payload.roomId)) {
        this.rooms.delete(payload.roomId)
        this.deps.onLocalRoomsChanged()
      }
      this.deps.onJoinRejected({ roomId: payload.roomId, reason: payload.reason })
      return
    }

    const room = this.rooms.get(payload.roomId)
    if (!room) return

    const leaverId = payload.leaverPeerId ?? fromPeerId
    if (leaverId && room.members.has(leaverId)) {
      const nickname = fromNickname || this.resolveNickname(leaverId)
      this.appendSystemMessage(payload.roomId, `${nickname}님이 나가셨습니다.`)
      room.members.delete(leaverId)
    }
    if (payload.members) {
      room.members = new Set(payload.members)
    }
    this.deps.onLocalRoomsChanged()
  }

  handleRoomClosed(payload: RoomClosedPayload) {
    this.pendingJoins.delete(payload.roomId)
    if (!this.rooms.has(payload.roomId)) return
    this.rooms.delete(payload.roomId)
    this.deps.onLocalRoomsChanged()
  }

  leaveRoom(roomId: string): { ok: boolean; error?: string } {
    if (this.pendingJoins.has(roomId)) {
      this.pendingJoins.delete(roomId)
      return { ok: true }
    }

    const room = this.rooms.get(roomId)
    if (!room) {
      return { ok: false, error: 'not_found' }
    }

    const isLastMember =
      room.members.size === 1 && room.members.has(this.deps.local.peerId)

    if (isLastMember) {
      this.broadcastRoomClosed(roomId)
    } else {
      const remainingMembers = Array.from(room.members).filter(
        (id) => id !== this.deps.local.peerId
      )
      this.deps.broadcastToRoom(roomId, {
        type: 'leave_room',
        peerId: this.deps.local.peerId,
        nickname: this.deps.local.nickname,
        timestamp: Date.now(),
        payload: {
          roomId,
          reason: 'voluntary',
          leaverPeerId: this.deps.local.peerId,
          members: remainingMembers,
        } satisfies LeaveRoomPayload,
      })
    }

    this.rooms.delete(roomId)
    this.deps.onLocalRoomsChanged()
    return { ok: true }
  }

  private broadcastRoomClosed(roomId: string) {
    const msg: ProtocolMessage = {
      type: 'room_closed',
      peerId: this.deps.local.peerId,
      nickname: this.deps.local.nickname,
      timestamp: Date.now(),
      payload: {
        roomId,
        closedBy: this.deps.local.peerId,
      } satisfies RoomClosedPayload,
    }
    for (const peer of this.deps.getPeers()) {
      if (peer.peerId === this.deps.local.peerId) continue
      this.deps.sendDirect(peer.peerId, msg)
    }
  }

  handleRoomMembers(payload: RoomMembersPayload) {
    const pending = this.pendingJoins.get(payload.roomId)
    let room = this.rooms.get(payload.roomId)
    let joined = false

    if (!room && pending) {
      room = {
        roomId: payload.roomId,
        name: payload.name || pending.name,
        type: payload.type || pending.type,
        members: new Set(payload.members),
        messages: [],
      }
      if (room.type === 'private' && pending.password) {
        room.passwordHash = hashPassword(pending.password)
        room.encryptionKey = deriveKey(pending.password, payload.roomId)
      } else {
        room.encryptionKey = deriveRoomKey(payload.roomId)
      }
      this.pendingJoins.delete(payload.roomId)
      this.rooms.set(payload.roomId, room)
      this.appendSystemMessage(payload.roomId, `${this.deps.local.nickname}님이 참여하였습니다.`)
      joined = true
    } else if (room) {
      const previousMembers = new Set(room.members)
      for (const memberId of payload.members) {
        if (!previousMembers.has(memberId)) {
          this.appendSystemMessage(payload.roomId, `${this.resolveNickname(memberId)}님이 참여하였습니다.`)
        }
      }
      payload.members.forEach((m) => room!.members.add(m))
      if (payload.name) room.name = payload.name
      if (payload.type) room.type = payload.type
      if (room.isPending) {
        delete room.isPending
        joined = true
      }
    }

    if (joined) {
      this.deps.onLocalRoomsChanged()
      this.deps.onRoomJoined?.(payload.roomId)
    } else if (room) {
      this.deps.onLocalRoomsChanged()
    }
  }

  removeMemberFromAllRooms(peerId: string) {
    for (const room of this.rooms.values()) {
      room.members.delete(peerId)
    }
  }

  private appendSystemMessage(roomId: string, content: string) {
    const room = this.rooms.get(roomId)
    if (!room) return

    const chat: ChatMessage = {
      id: randomUUID(),
      roomId,
      senderId: 'system',
      senderName: '',
      content,
      timestamp: Date.now(),
      kind: 'system',
    }
    room.messages.push(chat)
  }

  private resolveNickname(peerId: string): string {
    if (peerId === this.deps.local.peerId) {
      return this.deps.local.nickname
    }
    const peer = this.deps.getPeers().find((p) => p.peerId === peerId)
    return peer?.nickname || '알 수 없음'
  }
}
