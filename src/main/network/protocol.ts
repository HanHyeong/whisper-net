export interface PeerInfo {
  peerId: string
  nickname: string
  ip: string
  tcpPort: number
  discoveryPort: number
  lastSeen: number
  rooms: RoomInfo[]
}

export interface RoomInfo {
  roomId: string
  name: string
  type: 'public' | 'private'
  memberCount: number
}

export type MessageType =
  | 'heartbeat'
  | 'discover'
  | 'discover_ack'
  | 'join_room'
  | 'leave_room'
  | 'room_members'
  | 'text_message'
  | 'file_attachment'
  | 'nickname_changed'
  | 'file_offer'
  | 'file_accept'
  | 'file_reject'
  | 'file_chunk'
  | 'file_complete'
  | 'typing'

export interface ProtocolMessage {
  type: MessageType
  peerId: string
  nickname: string
  timestamp: number
  payload?: any
}

export interface TextMessagePayload {
  roomId: string
  content: string
  messageId: string
}

export interface JoinRoomPayload {
  roomId: string
  passwordHash?: string
}

export interface RoomMembersPayload {
  roomId: string
  members: string[]
  name: string
  type: 'public' | 'private'
}

export interface FileOfferPayload {
  transferId: string
  fileName: string
  fileSize: number
  mimeType: string
}

export interface FileAttachmentPayload {
  roomId: string
  fileName: string
  fileSize: number
  checksum: string
  messageId: string
  /** Encrypted display content (e.g. "📎 filename"). Optional for backward compat. */
  content?: string
}

export interface FileChunkPayload {
  transferId: string
  chunk: string // base64
  index: number
  total: number
}

export function encodeMessage(msg: ProtocolMessage): Buffer {
  const json = JSON.stringify(msg)
  const buf = Buffer.from(json, 'utf-8')
  const len = Buffer.allocUnsafe(4)
  len.writeUInt32BE(buf.length, 0)
  return Buffer.concat([len, buf])
}

export function decodeMessages(data: Buffer): { messages: ProtocolMessage[]; remainder: Buffer } {
  const messages: ProtocolMessage[] = []
  let offset = 0

  while (offset + 4 <= data.length) {
    const len = data.readUInt32BE(offset)
    if (offset + 4 + len > data.length) break
    const jsonBuf = data.subarray(offset + 4, offset + 4 + len)
    const json = jsonBuf.toString('utf-8')
    try {
      messages.push(JSON.parse(json) as ProtocolMessage)
    } catch {
      // ignore malformed
    }
    offset += 4 + len
  }

  return { messages, remainder: data.subarray(offset) }
}
