import { randomUUID } from 'crypto'
import { encrypt, decrypt } from './crypto'
import { ConnectionPool } from './ConnectionPool'
import { PeerRegistry } from './PeerRegistry'
import { PeerSyncService } from './PeerSyncService'
import { RoomService } from './RoomService'
import {
  PeerInfo,
  ProtocolMessage,
  TextMessagePayload,
  FileAttachmentPayload,
  FileOfferPayload,
  FileChunkPayload,
  JoinRoomPayload,
  LeaveRoomPayload,
  RoomClosedPayload,
  RoomMembersPayload,
} from './protocol'
import { ChatMessage, LocalPeer } from './types'

export interface MessageServiceDeps {
  local: LocalPeer
  roomService: RoomService
  peerRegistry: PeerRegistry
  peerSync: PeerSyncService
  connectionPool: ConnectionPool
  sendDirect: (peerId: string, msg: ProtocolMessage) => void
  onChatMessage: (msg: ChatMessage) => void
  onFileOffer: (offer: Record<string, unknown>) => void
  onFileChunk: (chunk: FileChunkPayload) => void
}

export class MessageService {
  private seenMessages = new Set<string>()
  private readonly MAX_SEEN_MESSAGES = 10000

  constructor(private deps: MessageServiceDeps) {}

  handle(msg: ProtocolMessage, socket?: any) {
    switch (msg.type) {
      case 'text_message':
        this.handleTextMessage(msg)
        break
      case 'join_room':
        this.deps.roomService.handleJoinRoom(
          msg.peerId,
          msg.nickname,
          msg.payload as JoinRoomPayload
        )
        break
      case 'nickname_changed':
        if (this.deps.peerRegistry.get(msg.peerId)) {
          this.deps.peerRegistry.setNickname(msg.peerId, msg.nickname)
        }
        break
      case 'leave_room':
        this.deps.roomService.handleLeaveRoom(msg.payload as LeaveRoomPayload, msg.peerId, msg.nickname)
        break
      case 'room_closed':
        this.deps.roomService.handleRoomClosed(msg.payload as RoomClosedPayload)
        break
      case 'room_advertised':
        if (msg.payload?.rooms) {
          this.deps.peerSync.handleRoomAdvertised(msg.peerId, msg.payload.rooms)
        }
        break
      case 'file_attachment':
        this.handleFileAttachment(msg)
        break
      case 'room_members':
        this.deps.roomService.handleRoomMembers(msg.payload as RoomMembersPayload)
        break
      case 'file_offer':
        this.deps.onFileOffer({ from: msg.peerId, fromName: msg.nickname, ...msg.payload })
        break
      case 'file_chunk':
        this.deps.onFileChunk(msg.payload as FileChunkPayload)
        break
      case 'discover_ack':
        this.handleDiscoverAck(msg, socket)
        break
    }
  }

  sendText(roomId: string, content: string) {
    const room = this.deps.roomService.get(roomId)
    if (!room) return

    const messageId = randomUUID()
    let encryptedContent = content
    if (room.encryptionKey) {
      encryptedContent = encrypt(content, room.encryptionKey)
    }
    const msg: ProtocolMessage = {
      type: 'text_message',
      peerId: this.deps.local.peerId,
      nickname: this.deps.local.nickname,
      timestamp: Date.now(),
      payload: { roomId, content: encryptedContent, messageId } as TextMessagePayload,
    }
    this.markSeen(messageId)

    const chat: ChatMessage = {
      id: randomUUID(),
      roomId,
      senderId: this.deps.local.peerId,
      senderName: this.deps.local.nickname,
      content,
      timestamp: Date.now(),
    }
    room.messages.push(chat)
    this.broadcastToRoom(roomId, msg)
    this.deps.onChatMessage(chat)
  }

  sendFileAttachment(
    roomId: string,
    fileName: string,
    fileSize: number,
    checksum: string,
    messageId: string,
    localPath: string,
    dataUrl?: string
  ) {
    const room = this.deps.roomService.get(roomId)
    if (!room) return

    let content = `📎 ${fileName}`
    if (room.encryptionKey) {
      content = encrypt(content, room.encryptionKey)
    }
    const msg: ProtocolMessage = {
      type: 'file_attachment',
      peerId: this.deps.local.peerId,
      nickname: this.deps.local.nickname,
      timestamp: Date.now(),
      payload: { roomId, fileName, fileSize, checksum, messageId, content } as FileAttachmentPayload,
    }
    this.markSeen(messageId)

    const chat: ChatMessage = {
      id: randomUUID(),
      roomId,
      senderId: this.deps.local.peerId,
      senderName: this.deps.local.nickname,
      content: room.encryptionKey ? `📎 ${fileName}` : content,
      timestamp: Date.now(),
      attachment: {
        fileName,
        fileSize,
        checksum,
        senderId: this.deps.local.peerId,
        messageId,
        localPath,
        dataUrl,
      },
    }
    room.messages.push(chat)
    this.broadcastToRoom(roomId, msg)
    this.deps.onChatMessage(chat)
  }

  offerFile(peerId: string, fileName: string, fileSize: number, mimeType: string) {
    const transferId = randomUUID()
    this.deps.sendDirect(peerId, {
      type: 'file_offer',
      peerId: this.deps.local.peerId,
      nickname: this.deps.local.nickname,
      timestamp: Date.now(),
      payload: { transferId, fileName, fileSize, mimeType } as FileOfferPayload,
    })
    return transferId
  }

  sendFileChunk(peerId: string, transferId: string, chunk: Buffer, index: number, total: number) {
    this.deps.sendDirect(peerId, {
      type: 'file_chunk',
      peerId: this.deps.local.peerId,
      nickname: this.deps.local.nickname,
      timestamp: Date.now(),
      payload: {
        transferId,
        chunk: chunk.toString('base64'),
        index,
        total,
      } as FileChunkPayload,
    })
  }

  broadcastToRoom(roomId: string, msg: ProtocolMessage, excludePeerId?: string) {
    const room = this.deps.roomService.get(roomId)
    if (!room) return

    let members = Array.from(room.members).filter(
      (id) => id !== this.deps.local.peerId && id !== excludePeerId
    )

    const FANOUT = 3
    if (members.length > FANOUT) {
      members = this.shuffleArray(members).slice(0, FANOUT)
    }

    for (const memberId of members) {
      this.deps.sendDirect(memberId, msg)
    }
  }

  private handleTextMessage(msg: ProtocolMessage) {
    const p = msg.payload as TextMessagePayload
    if (!this.markSeen(p.messageId)) return

    const room = this.deps.roomService.get(p.roomId)
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
    this.deps.onChatMessage(chat)
    this.broadcastToRoom(p.roomId, msg, msg.peerId)
  }

  private handleFileAttachment(msg: ProtocolMessage) {
    const p = msg.payload as FileAttachmentPayload
    if (!this.markSeen(p.messageId)) return

    const room = this.deps.roomService.get(p.roomId)
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
    this.deps.onChatMessage(chat)
    this.broadcastToRoom(p.roomId, msg, msg.peerId)
  }

  private handleDiscoverAck(msg: ProtocolMessage, socket?: any) {
    if (!socket) return

    this.deps.connectionPool.registerSocket(msg.peerId, socket)
    const existing = this.deps.peerRegistry.get(msg.peerId)
    const peerInfo: PeerInfo = existing
      ? {
          ...existing,
          nickname: msg.nickname,
          ...(msg.payload?.rooms ? { rooms: msg.payload.rooms } : {}),
          ...(msg.payload?.tcpPort ? { tcpPort: msg.payload.tcpPort } : {}),
          ...(msg.payload?.discoveryPort ? { discoveryPort: msg.payload.discoveryPort } : {}),
          lastSeen: Date.now(),
        }
      : {
          peerId: msg.peerId,
          nickname: msg.nickname,
          ip: socket.remoteAddress?.replace(/^::ffff:/, '') || '',
          tcpPort: msg.payload?.tcpPort || 41235,
          discoveryPort: msg.payload?.discoveryPort || 8080,
          lastSeen: Date.now(),
          rooms: msg.payload?.rooms || [],
        }
    this.deps.peerSync.handleDiscoverAck(peerInfo)
    this.deps.peerSync.onDiscoverAck(msg.peerId)
  }

  private markSeen(messageId: string): boolean {
    if (this.seenMessages.has(messageId)) return false
    this.seenMessages.add(messageId)
    if (this.seenMessages.size > this.MAX_SEEN_MESSAGES) {
      const toDelete = Math.floor(this.MAX_SEEN_MESSAGES / 2)
      const iter = this.seenMessages.values()
      for (let i = 0; i < toDelete; i++) {
        const val = iter.next().value
        if (val) this.seenMessages.delete(val)
      }
    }
    return true
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
}
