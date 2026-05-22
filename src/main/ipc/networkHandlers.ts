import { ipcMain } from 'electron'
import { NetworkManager } from '../network/NetworkManager'
import { ipcState, sendToRenderer, serializeRooms, serializeRoom } from './context'

export function setupNetworkEvents(
  network: NetworkManager,
  onUnreadMessage: (msg: {
    roomId: string
    content?: string
    nickname?: string
    senderName?: string
    payload?: { content?: string }
  }) => void
) {
  network.on('peers', (peers) => sendToRenderer('network:peers', peers))
  network.on('rooms', (rooms) => sendToRenderer('network:rooms', serializeRooms(rooms)))
  network.on('join:rejected', (info) => sendToRenderer('network:join-rejected', info))
  network.on('room:joined', (roomId) => sendToRenderer('network:room-joined', roomId))
  network.on('message', (msg) => {
    sendToRenderer('network:message', msg)
    onUnreadMessage(msg)
  })
  network.on('file:offer', (offer) => sendToRenderer('network:file:offer', offer))
  network.on('file:chunk', (chunkPayload) => {
    handleIncomingFileChunk(chunkPayload)
  })
}

function handleIncomingFileChunk(chunkPayload: {
  transferId: string
  chunk: string
  index: number
  total: number
}) {
  const t = ipcState.activeTransfers.get(chunkPayload.transferId)
  if (!t?.savePath || !t.writeStream) return

  const buf = Buffer.from(chunkPayload.chunk, 'base64')
  t.writeStream.write(buf)
  t.received += buf.length
  sendToRenderer('file:progress', {
    transferId: chunkPayload.transferId,
    received: t.received,
    total: t.total,
    direction: 'download',
  })
  if (t.received >= t.total) {
    t.writeStream.end()
    ipcState.activeTransfers.delete(chunkPayload.transferId)
    sendToRenderer('file:complete', { transferId: chunkPayload.transferId, savePath: t.savePath })
  }
}

export function registerNetworkHandlers(initialNickname: string) {
  ipcMain.once('app:renderer-ready', () => {
    sendToRenderer('network:local', { peerId: ipcState.peerId, nickname: initialNickname })
    ipcState.network?.schedulePeerRefresh(500)
  })

  ipcMain.handle('net:create-room', (_, name: string, type: 'public' | 'private', password?: string) => {
    const room = ipcState.network?.createRoom(name, type, password)
    if (!room) {
      return { error: type === 'private' ? '비밀번호를 입력하세요.' : '방을 만들 수 없습니다.' }
    }
    return serializeRoom(room)
  })

  ipcMain.handle('net:join-room', (_, roomId: string, password?: string, name?: string, type?: 'public' | 'private') => {
    ipcState.network?.joinRoom(roomId, password, name, type)
  })

  ipcMain.handle('net:leave-room', (_, roomId: string) => {
    const result = ipcState.network?.leaveRoom(roomId) ?? { ok: false, error: 'not_found' }
    if (result.ok) {
      ipcState.mutedRoomIds.delete(roomId)
    }
    return result
  })

  ipcMain.handle('net:send-text', (_, roomId: string, content: string) => {
    ipcState.network?.sendText(roomId, content)
  })

  ipcMain.handle('net:get-peers', () => ipcState.network?.getPeers() ?? [])

  ipcMain.handle('net:get-rooms', () => serializeRooms(ipcState.network?.getRooms() ?? []))

  ipcMain.handle('net:connect-peer', async (_, ip: string, port: number) => {
    ipcState.network?.connectPeer(ip, port)
  })

  ipcMain.handle('net:refresh-peers', async () => ipcState.network?.refreshPeers() ?? 0)
}
