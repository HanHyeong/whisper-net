import { create } from 'zustand'

export interface Peer {
  peerId: string
  nickname: string
  ip: string
  tcpPort: number
  discoveryPort: number
  rooms: any[]
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
  members: string[]
  messages: ChatMessage[]
}

export interface FileTransfer {
  transferId: string
  fileName: string
  direction: 'upload' | 'download'
  received: number
  total: number
  peerId: string
  status: 'pending' | 'transferring' | 'complete' | 'cancelled'
  savePath?: string
}

interface AppState {
  localPeerId: string
  localNickname: string
  sharedFolder: string | null
  peers: Peer[]
  rooms: Room[]
  activeRoomId: string | null
  transfers: FileTransfer[]
  unreadCounts: Record<string, number>
  mutedRoomIds: Set<string>
  setLocalPeerId: (id: string) => void
  setLocalNickname: (name: string) => void
  setSharedFolder: (path: string | null) => void
  setPeers: (peers: Peer[]) => void
  setRooms: (rooms: Room[]) => void
  addRoom: (room: Room) => void
  addMessage: (msg: ChatMessage) => void
  setActiveRoom: (id: string | null) => void
  addTransfer: (t: FileTransfer) => void
  updateTransfer: (id: string, patch: Partial<FileTransfer>) => void
  removeTransfer: (id: string) => void
  incrementUnread: (roomId: string) => void
  clearUnread: (roomId: string) => void
  updateMessageAttachment: (roomId: string, messageId: string, patch: Partial<AttachmentInfo>) => void
  toggleRoomMute: (roomId: string) => void
  isRoomMuted: (roomId: string) => boolean
}

export const useAppStore = create<AppState>((set, get) => ({
  localPeerId: '',
  localNickname: '',
  sharedFolder: null,
  peers: [],
  rooms: [],
  activeRoomId: null,
  transfers: [],
  unreadCounts: {},
  setLocalPeerId: (id) => set({ localPeerId: id }),
  setLocalNickname: (name) => set({ localNickname: name }),
  setSharedFolder: (path) => set({ sharedFolder: path }),
  setPeers: (peers) => set({ peers }),
  setRooms: (rooms) => set({ rooms }),
  addRoom: (room) => set((state) => ({ rooms: [...state.rooms, room] })),
  addMessage: (msg) =>
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.roomId === msg.roomId
          ? { ...r, messages: [...r.messages, msg] }
          : r
      ),
    })),
  updateMessageAttachment: (roomId: string, messageId: string, patch: Partial<AttachmentInfo>) =>
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.roomId === roomId
          ? {
              ...r,
              messages: r.messages.map((m) =>
                m.attachment?.messageId === messageId
                  ? { ...m, attachment: { ...m.attachment, ...patch } }
                  : m
              ),
            }
          : r
      ),
    })),
  setActiveRoom: (id) => set({ activeRoomId: id }),
  addTransfer: (t) => set((state) => ({ transfers: [...state.transfers, t] })),
  updateTransfer: (id, patch) =>
    set((state) => ({
      transfers: state.transfers.map((t) => (t.transferId === id ? { ...t, ...patch } : t)),
    })),
  removeTransfer: (id) =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.transferId !== id),
    })),
  incrementUnread: (roomId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: (state.unreadCounts[roomId] || 0) + 1,
      },
    })),
  clearUnread: (roomId) =>
    set((state) => {
      const next = { ...state.unreadCounts }
      delete next[roomId]
      return { unreadCounts: next }
    }),
  mutedRoomIds: new Set<string>(),
  toggleRoomMute: (roomId) =>
    set((state) => {
      const next = new Set(state.mutedRoomIds)
      if (next.has(roomId)) next.delete(roomId)
      else next.add(roomId)
      return { mutedRoomIds: next }
    }),
  isRoomMuted: (roomId) => get().mutedRoomIds.has(roomId),
}))
