import { BrowserWindow } from 'electron'
import fs from 'fs'
import { NetworkManager } from '../network/NetworkManager'
import { Room } from '../network/types'
import { UpdateService } from '../update/UpdateService'

export interface ActiveTransfer {
  filePath?: string
  savePath?: string
  writeStream?: fs.WriteStream
  received: number
  total: number
  peerId: string
}

export const ipcState = {
  network: null as NetworkManager | null,
  updateService: null as UpdateService | null,
  mainWin: null as BrowserWindow | null,
  peerId: '',
  initialSharedPath: undefined as string | undefined,
  appVersion: '0.0.0',
  mutedRoomIds: new Set<string>(),
  showNotificationPreview: true,
  activeTransfers: new Map<string, ActiveTransfer>(),
  handlersRegistered: false,
}

export function sendToRenderer(channel: string, ...args: unknown[]) {
  const win = ipcState.mainWin
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}

export function serializeRoom(room: Room) {
  const { isPending: _pending, ...rest } = room
  return {
    ...rest,
    members: Array.isArray(room.members) ? room.members : Array.from(room.members ?? []),
    messages: room.messages ?? [],
  }
}

export function serializeRooms(rooms: ReturnType<NetworkManager['getRooms']>) {
  return rooms.map(serializeRoom)
}
