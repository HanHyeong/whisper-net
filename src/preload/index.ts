import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getConfig: () => ipcRenderer.invoke('app:get-config'),
  setNickname: (nickname: string) => ipcRenderer.invoke('app:set-nickname', nickname),

  createRoom: (name: string, type: 'public' | 'private', password?: string) =>
    ipcRenderer.invoke('net:create-room', name, type, password),
  joinRoom: (roomId: string, password?: string, name?: string, type?: 'public' | 'private') =>
    ipcRenderer.invoke('net:join-room', roomId, password, name, type),
  sendText: (roomId: string, content: string) =>
    ipcRenderer.invoke('net:send-text', roomId, content),
  sendFileAttachment: (roomId: string) =>
    ipcRenderer.invoke('net:send-file-attachment', roomId),
  downloadAttachment: (roomId: string, messageId: string, fileName: string, senderIp: string, senderDiscoveryPort: number) =>
    ipcRenderer.invoke('net:download-attachment', roomId, messageId, fileName, senderIp, senderDiscoveryPort),
  getPeers: () => ipcRenderer.invoke('net:get-peers'),
  getRooms: () => ipcRenderer.invoke('net:get-rooms'),
  connectPeer: (ip: string, port: number) => ipcRenderer.invoke('net:connect-peer', ip, port),
  offerFile: (peerId: string) => ipcRenderer.invoke('net:offer-file', peerId),
  acceptFile: (peerId: string, transferId: string, fileName: string) =>
    ipcRenderer.invoke('net:accept-file', peerId, transferId, fileName),
  cancelTransfer: (transferId: string) => ipcRenderer.invoke('net:cancel-transfer', transferId),
  setSharedFolder: (path?: string | null) => ipcRenderer.invoke('app:set-shared-folder', path),
  getSharedFolder: () => ipcRenderer.invoke('app:get-shared-folder'),
  rendererReady: () => ipcRenderer.send('app:renderer-ready'),
  listPeerFiles: (ip: string, discoveryPort: number, relativePath?: string) => ipcRenderer.invoke('net:list-peer-files', ip, discoveryPort, relativePath),
  downloadPeerFiles: (ip: string, discoveryPort: number, files: string[], destDir: string, basePath?: string) => ipcRenderer.invoke('net:download-peer-files', ip, discoveryPort, files, destDir, basePath),

  onPeers: (cb: (peers: any[]) => void) => {
    const handler = (_: any, peers: any[]) => cb(peers)
    ipcRenderer.on('network:peers', handler)
    return () => ipcRenderer.removeListener('network:peers', handler)
  },
  onMessage: (cb: (msg: any) => void) => {
    const handler = (_: any, msg: any) => cb(msg)
    ipcRenderer.on('network:message', handler)
    return () => ipcRenderer.removeListener('network:message', handler)
  },
  onFileOffer: (cb: (offer: any) => void) => {
    const handler = (_: any, offer: any) => cb(offer)
    ipcRenderer.on('network:file:offer', handler)
    return () => ipcRenderer.removeListener('network:file:offer', handler)
  },
  onFileChunk: (cb: (chunk: any) => void) => {
    const handler = (_: any, chunk: any) => cb(chunk)
    ipcRenderer.on('network:file:chunk', handler)
    return () => ipcRenderer.removeListener('network:file:chunk', handler)
  },
  onLocal: (cb: (info: { peerId: string; nickname: string }) => void) => {
    const handler = (_: any, info: any) => cb(info)
    ipcRenderer.on('network:local', handler)
    return () => ipcRenderer.removeListener('network:local', handler)
  },
  onFileProgress: (cb: (info: any) => void) => {
    const handler = (_: any, info: any) => cb(info)
    ipcRenderer.on('file:progress', handler)
    return () => ipcRenderer.removeListener('file:progress', handler)
  },
  onFileComplete: (cb: (info: any) => void) => {
    const handler = (_: any, info: any) => cb(info)
    ipcRenderer.on('file:complete', handler)
    return () => ipcRenderer.removeListener('file:complete', handler)
  },
}

contextBridge.exposeInMainWorld('whisperAPI', api)

declare global {
  interface Window {
    whisperAPI: typeof api
  }
}
