import { EventEmitter } from 'events'
import { DiscoveryManager } from './DiscoveryManager'
import { TcpServer } from './TcpServer'
import { TcpClient } from './TcpClient'
import {
  PeerInfo,
  ProtocolMessage,
  TextMessagePayload,
  JoinRoomPayload,
  RoomMembersPayload,
  FileAttachmentPayload,
  FileOfferPayload,
  FileChunkPayload,
} from './protocol'
import { randomUUID } from 'crypto'
import { deriveKey, deriveRoomKey, encrypt, decrypt, hashPassword } from './crypto'

export interface LocalPeer {
  peerId: string
  nickname: string
  tcpPort: number
}

export interface AttachmentInfo {
  fileName: string
  fileSize: number
  checksum: string
  senderId: string
  messageId: string
  localPath?: string
  dataUrl?: string
}

export interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  attachment?: AttachmentInfo
}

export interface Room {
  roomId: string
  name: string
  type: 'public' | 'private'
  members: Set<string> // peerIds
  messages: ChatMessage[]
  encryptionKey?: Buffer
  passwordHash?: string
}

export class NetworkManager extends EventEmitter {
  private discovery: DiscoveryManager
  private server: TcpServer
  private client: TcpClient
  private rooms = new Map<string, Room>()
  private peers = new Map<string, PeerInfo>()
  private seenMessages = new Set<string>() // dedup for gossip
  private readonly MAX_SEEN_MESSAGES = 10000

  constructor(private local: LocalPeer) {
    super()
    this.discovery = new DiscoveryManager(
      local.peerId,
      local.nickname,
      local.tcpPort,
      []
    )
    this.server = new TcpServer(local.tcpPort)
    this.client = new TcpClient()
  }

  async start() {
    this.server.start()
    this.server.on('message', (msg, socket) => this.handleMessage(msg, socket))
    this.server.on('peer:disconnect', (peerId) => {
      this.handlePeerDisconnect(peerId)
    })

    this.client.on('disconnected', (peerId) => {
      this.handlePeerDisconnect(peerId)
    })

    this.client.on('message', (msg) => this.handleMessage(msg))
    this.client.on('connected', (peerId, socket) => {
      this.server.registerSocket(peerId, socket)
      // Send discover_ack so the peer can register our socket on their server
      this.client.send(peerId, {
        type: 'discover_ack',
        peerId: this.local.peerId,
        nickname: this.local.nickname,
        timestamp: Date.now(),
        payload: { tcpPort: this.local.tcpPort },
      })
    })

    this.discovery.start()
    this.discovery.on('peer:joined', (info) => {
      this.peers.set(info.peerId, info)
      this.emit('peers', this.getPeers())
      // auto-connect tcp
      this.client.connect(info.peerId, info.ip, info.tcpPort)
    })
    this.discovery.on('peer:updated', (info) => {
      this.peers.set(info.peerId, info)
      this.emit('peers', this.getPeers())
    })
    this.discovery.on('peer:left', (peerId) => {
      this.peers.delete(peerId)
      this.client.disconnect(peerId)
      // Remove peer from all rooms they were in
      for (const room of this.rooms.values()) {
        if (room.members.delete(peerId)) {
          // If only I'm left, keep the room alive so I can continue chatting
          // and re-advertise it for others to rejoin
        }
      }
      this.updateDiscoveryRooms()
      this.emit('peers', this.getPeers())
      this.emit('rooms', this.getRooms())
    })
  }

  private handleMessage(msg: ProtocolMessage, socket?: any) {
    switch (msg.type) {
      case 'text_message': {
        const p = msg.payload as TextMessagePayload
        const msgId = p.messageId
        // Gossip deduplication
        if (this.seenMessages.has(msgId)) return
        this.seenMessages.add(msgId)
        // Prevent memory leak: trim old entries when too large
        if (this.seenMessages.size > this.MAX_SEEN_MESSAGES) {
          const toDelete = Math.floor(this.MAX_SEEN_MESSAGES / 2)
          const iter = this.seenMessages.values()
          for (let i = 0; i < toDelete; i++) {
            const val = iter.next().value
            if (val) this.seenMessages.delete(val)
          }
        }

        const room = this.rooms.get(p.roomId)
        if (!room) return
        let decryptedContent = p.content
        if (room.encryptionKey) {
          try {
            decryptedContent = decrypt(p.content, room.encryptionKey)
          } catch {
            decryptedContent = '[복호화 실패]'
          }
        }
        const chat: ChatMessage = {
          id: randomUUID(),
          roomId: p.roomId,
          senderId: msg.peerId,
          senderName: msg.nickname,
          content: decryptedContent,
          timestamp: msg.timestamp,
        }
        room.messages.push(chat)
        this.emit('message', chat)
        // Relay to all room members except original sender
        this.broadcastToRoom(p.roomId, msg, msg.peerId)
        break
      }
      case 'join_room': {
        const p = msg.payload as JoinRoomPayload
        const room = this.rooms.get(p.roomId)
        if (!room) return
        if (room.type === 'private') {
          const hash = p.passwordHash ?? ''
          if (!room.passwordHash || hash !== room.passwordHash) {
            this.sendDirect(msg.peerId, { type: 'leave_room', peerId: this.local.peerId, nickname: this.local.nickname, timestamp: Date.now(), payload: { roomId: p.roomId, reason: 'wrong_password' } })
            return
          }
        }
        room.members.add(msg.peerId)
        // sync members + room info
        this.broadcastToRoom(p.roomId, {
          type: 'room_members',
          peerId: this.local.peerId,
          nickname: this.local.nickname,
          timestamp: Date.now(),
          payload: {
            roomId: p.roomId,
            members: Array.from(room.members),
            name: room.name,
            type: room.type,
          } as RoomMembersPayload,
        })
        break
      }
      case 'nickname_changed': {
        const peer = this.peers.get(msg.peerId)
        if (peer) {
          peer.nickname = msg.nickname
          this.emit('peers', this.getPeers())
        }
        break
      }
      case 'leave_room': {
        const p = msg.payload as { roomId: string; reason?: string }
        if (p.roomId && this.rooms.has(p.roomId)) {
          this.rooms.delete(p.roomId)
          this.updateDiscoveryRooms()
          this.emit('rooms', this.getRooms())
        }
        break
      }
      case 'room_advertised': {
        const peer = this.peers.get(msg.peerId)
        if (peer && msg.payload?.rooms) {
          peer.rooms = msg.payload.rooms
          this.emit('peers', this.getPeers())
        }
        break
      }
      case 'file_attachment': {
        const p = msg.payload as FileAttachmentPayload
        const msgId = p.messageId
        // Gossip deduplication (same as text_message)
        if (this.seenMessages.has(msgId)) return
        this.seenMessages.add(msgId)
        if (this.seenMessages.size > this.MAX_SEEN_MESSAGES) {
          const toDelete = Math.floor(this.MAX_SEEN_MESSAGES / 2)
          const iter = this.seenMessages.values()
          for (let i = 0; i < toDelete; i++) {
            const val = iter.next().value
            if (val) this.seenMessages.delete(val)
          }
        }

        const room = this.rooms.get(p.roomId)
        if (!room) return
        let decryptedContent = `📎 ${p.fileName}`
        if (room.encryptionKey && p.content) {
          try {
            decryptedContent = decrypt(p.content, room.encryptionKey)
          } catch {
            decryptedContent = `📎 ${p.fileName}`
          }
        }
        const chat: ChatMessage = {
          id: randomUUID(),
          roomId: p.roomId,
          senderId: msg.peerId,
          senderName: msg.nickname,
          content: decryptedContent,
          timestamp: msg.timestamp,
          attachment: {
            fileName: p.fileName,
            fileSize: p.fileSize,
            checksum: p.checksum,
            senderId: msg.peerId,
            messageId: p.messageId,
          },
        }
        room.messages.push(chat)
        this.emit('message', chat)
        this.broadcastToRoom(p.roomId, msg, msg.peerId)
        break
      }
      case 'room_members': {
        const p = msg.payload as RoomMembersPayload
        const room = this.rooms.get(p.roomId)
        if (room) {
          p.members.forEach((m) => room.members.add(m))
          // Update room name/type from owner
          if (p.name) room.name = p.name
          if (p.type) room.type = p.type
        }
        break
      }
      case 'file_offer': {
        const p = msg.payload as FileOfferPayload
        this.emit('file:offer', { from: msg.peerId, fromName: msg.nickname, ...p })
        break
      }
      case 'file_chunk': {
        const p = msg.payload as FileChunkPayload
        this.emit('file:chunk', p)
        break
      }
      case 'discover_ack': {
        if (socket) {
          this.server.registerSocket(msg.peerId, socket)
          // Update peer info if we don't have it yet
          const existing = this.peers.get(msg.peerId)
          if (!existing) {
            const peer: PeerInfo = {
              peerId: msg.peerId,
              nickname: msg.nickname,
              ip: socket.remoteAddress?.replace(/^::ffff:/, '') || '',
              tcpPort: msg.payload?.tcpPort || 41235,
              discoveryPort: 8080,
              lastSeen: Date.now(),
              rooms: msg.payload?.rooms || [],
            }
            this.peers.set(msg.peerId, peer)
            this.emit('peers', this.getPeers())
          }
        }
        break
      }
    }
  }

  createRoom(name: string, type: 'public' | 'private', password?: string): Room {
    const roomId = randomUUID()
    const room: Room = {
      roomId,
      name,
      type,
      members: new Set([this.local.peerId]),
      messages: [],
    }
    if (type === 'private' && password) {
      room.passwordHash = hashPassword(password)
      room.encryptionKey = deriveKey(password, roomId)
    } else {
      // General rooms: key derived from roomId only
      room.encryptionKey = deriveRoomKey(roomId)
    }
    this.rooms.set(roomId, room)
    this.updateDiscoveryRooms()
    this.advertiseRooms()
    return room
  }

  joinRoom(roomId: string, password?: string, name?: string, type?: 'public' | 'private') {
    const room = this.rooms.get(roomId)
    if (room) {
      room.members.add(this.local.peerId)
      if (room.type === 'private' && password && !room.encryptionKey) {
        room.encryptionKey = deriveKey(password, roomId)
      }
      return
    }
    // find a peer that has this room and send join
    for (const peer of this.peers.values()) {
      if (peer.rooms.some((r) => r.roomId === roomId)) {
        const payload: JoinRoomPayload = { roomId }
        if (password) {
          payload.passwordHash = hashPassword(password)
        }
        this.sendDirect(peer.peerId, {
          type: 'join_room',
          peerId: this.local.peerId,
          nickname: this.local.nickname,
          timestamp: Date.now(),
          payload,
        })
        // Do NOT create a local stub here. Wait for room_members (success)
        // or leave_room (rejected) from the owner.
        return
      }
    }
  }

  sendFileAttachment(roomId: string, fileName: string, fileSize: number, checksum: string, messageId: string, localPath: string, dataUrl?: string) {
    const room = this.rooms.get(roomId)
    if (!room) return
    let content = `📎 ${fileName}`
    if (room.encryptionKey) {
      content = encrypt(content, room.encryptionKey)
    }
    const msg: ProtocolMessage = {
      type: 'file_attachment',
      peerId: this.local.peerId,
      nickname: this.local.nickname,
      timestamp: Date.now(),
      payload: { roomId, fileName, fileSize, checksum, messageId, content } as FileAttachmentPayload,
    }
    // Mark as seen locally so we don't relay our own attachment back to us
    this.seenMessages.add(messageId)
    const chat: ChatMessage = {
      id: randomUUID(),
      roomId,
      senderId: this.local.peerId,
      senderName: this.local.nickname,
      content: room.encryptionKey ? `📎 ${fileName}` : content,
      timestamp: Date.now(),
      attachment: {
        fileName,
        fileSize,
        checksum,
        senderId: this.local.peerId,
        messageId,
        localPath,
        dataUrl,
      },
    }
    room.messages.push(chat)
    this.broadcastToRoom(roomId, msg)
    this.emit('message', chat)
  }

  sendText(roomId: string, content: string) {
    const room = this.rooms.get(roomId)
    if (!room) return
    const messageId = randomUUID()
    let encryptedContent = content
    if (room.encryptionKey) {
      encryptedContent = encrypt(content, room.encryptionKey)
    }
    const msg: ProtocolMessage = {
      type: 'text_message',
      peerId: this.local.peerId,
      nickname: this.local.nickname,
      timestamp: Date.now(),
      payload: { roomId, content: encryptedContent, messageId } as TextMessagePayload,
    }
    // mark as seen locally
    this.seenMessages.add(messageId)

    const chat: ChatMessage = {
      id: randomUUID(),
      roomId,
      senderId: this.local.peerId,
      senderName: this.local.nickname,
      content,
      timestamp: Date.now(),
    }
    room.messages.push(chat)
    this.broadcastToRoom(roomId, msg)
    this.emit('message', chat)
  }

  offerFile(peerId: string, fileName: string, fileSize: number, mimeType: string) {
    const transferId = randomUUID()
    this.sendDirect(peerId, {
      type: 'file_offer',
      peerId: this.local.peerId,
      nickname: this.local.nickname,
      timestamp: Date.now(),
      payload: { transferId, fileName, fileSize, mimeType } as FileOfferPayload,
    })
    return transferId
  }

  sendFileChunk(peerId: string, transferId: string, chunk: Buffer, index: number, total: number) {
    this.sendDirect(peerId, {
      type: 'file_chunk',
      peerId: this.local.peerId,
      nickname: this.local.nickname,
      timestamp: Date.now(),
      payload: {
        transferId,
        chunk: chunk.toString('base64'),
        index,
        total,
      } as FileChunkPayload,
    })
  }

  updateNickname(nickname: string) {
    this.local.nickname = nickname
    this.discovery.setNickname?.(nickname)
    // Broadcast nickname change to all known peers immediately
    for (const peerId of this.peers.keys()) {
      this.sendDirect(peerId, {
        type: 'nickname_changed',
        peerId: this.local.peerId,
        nickname: this.local.nickname,
        timestamp: Date.now(),
      })
    }
  }

  async refreshPeers(): Promise<number> {
    return this.discovery.refreshPeers()
  }

  getSharedPath(): string | null {
    return this.discovery.getSharedPath()
  }

  setSharedPath(p: string | null) {
    this.discovery.setSharedPath(p)
  }

  connectPeer(ip: string, port: number) {
    const peerId = `manual-${ip}-${port}`
    this.client.connect(peerId, ip, port).then((connected) => {
      if (connected) {
        // send a heartbeat-like message so the peer knows us
        this.client.send(peerId, {
          type: 'discover_ack',
          peerId: this.local.peerId,
          nickname: this.local.nickname,
          timestamp: Date.now(),
          payload: { tcpPort: this.local.tcpPort, rooms: [] },
        })
      }
    })
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  getRooms(): Room[] {
    return Array.from(this.rooms.values())
  }

  getLocalIp(): string {
    return this.discovery.getLocalIp()
  }

  getTcpPort(): number {
    return this.local.tcpPort
  }

  getDiscoveryPort(): number {
    return this.discovery.getDiscoveryPort()
  }

  private broadcastToRoom(roomId: string, msg: ProtocolMessage, excludePeerId?: string) {
    const room = this.rooms.get(roomId)
    if (!room) return
    let members = Array.from(room.members).filter(
      (id) => id !== this.local.peerId && id !== excludePeerId
    )

    // Fanout limit: prevent network overload in large rooms
    const FANOUT = 3
    if (members.length > FANOUT) {
      members = this.shuffleArray(members).slice(0, FANOUT)
    }

    for (const memberId of members) {
      this.sendDirect(memberId, msg)
    }
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  private advertiseRooms() {
    const rooms = this.getRooms().map((r) => ({
      roomId: r.roomId,
      name: r.name,
      type: r.type,
      memberCount: r.members.size,
    }))
    const msg: ProtocolMessage = {
      type: 'room_advertised',
      peerId: this.local.peerId,
      nickname: this.local.nickname,
      timestamp: Date.now(),
      payload: { rooms },
    }
    for (const peerId of this.peers.keys()) {
      if (peerId === this.local.peerId) continue
      this.sendDirect(peerId, msg)
    }
  }

  private sendDirect(peerId: string, msg: ProtocolMessage) {
    const ok = this.server.send(peerId, msg) || this.client.send(peerId, msg)
    if (!ok) {
      const peer = this.peers.get(peerId)
      if (peer) {
        this.client.connect(peerId, peer.ip, peer.tcpPort).then((connected) => {
          if (connected) this.client.send(peerId, msg)
        })
      }
    }
  }

  private handlePeerDisconnect(peerId: string) {
    if (!this.peers.has(peerId)) return
    this.peers.delete(peerId)
    this.client.disconnect(peerId)
    // Remove peer from all rooms they were in
    for (const room of this.rooms.values()) {
      room.members.delete(peerId)
    }
    this.updateDiscoveryRooms()
    this.emit('peers', this.getPeers())
    this.emit('rooms', this.getRooms())
  }

  private updateDiscoveryRooms() {
    const roomList = Array.from(this.rooms.values()).map((r) => ({
      roomId: r.roomId,
      name: r.name,
      type: r.type,
      memberCount: r.members.size,
    }))
    this.discovery.setRooms(roomList)
  }

  stop() {
    this.discovery.stop()
    this.server.stop()
    this.client.disconnectAll()
  }
}
