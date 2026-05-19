import { create } from 'zustand'

export interface Peer {
  peerId: string
  nickname: string
  ip: string
  tcpPort: number
  discoveryPort: number
  rooms: any[]
}

export interface ChatMessage {
  id: string
  roomId: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
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
}

export const useAppStore = create<AppState>((set) => ({
  localPeerId: '',
  localNickname: '',
  sharedFolder: null,
  peers: [],
  rooms: [],
  activeRoomId: null,
  transfers: [],
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
}))
