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
  kind?: 'text' | 'system'
  attachment?: AttachmentInfo
}

export interface Room {
  roomId: string
  name: string
  type: 'public' | 'private'
  members: Set<string>
  messages: ChatMessage[]
  encryptionKey?: Buffer
  passwordHash?: string
  isPending?: boolean
}
