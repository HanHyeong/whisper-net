import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { randomUUID, createHash } from 'crypto'
import fs from 'fs'
import { NetworkManager } from './network/NetworkManager'
import { loadConfig, saveConfig } from './utils/config'

const isDev = !app.isPackaged
let network: NetworkManager | null = null
let mainWin: BrowserWindow | null = null

// File transfer state
const activeTransfers = new Map<
  string,
  {
    filePath?: string
    savePath?: string
    writeStream?: fs.WriteStream
    received: number
    total: number
    peerId: string
  }
>()

function createWindow(initialNickname: string) {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWin = win

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  const peerId = randomUUID()
  const tcpPort = 41235 + Math.floor(Math.random() * 1000)
  network = new NetworkManager({ peerId, nickname: initialNickname, tcpPort })

  network.on('peers', (peers) => {
    win.webContents.send('network:peers', peers)
  })
  network.on('message', (msg) => {
    win.webContents.send('network:message', msg)
  })
  network.on('file:offer', (offer) => {
    win.webContents.send('network:file:offer', offer)
  })
  network.on('file:chunk', (chunkPayload) => {
    const t = activeTransfers.get(chunkPayload.transferId)
    if (t && t.savePath && t.writeStream) {
      const buf = Buffer.from(chunkPayload.chunk, 'base64')
      t.writeStream.write(buf)
      t.received += buf.length
      win.webContents.send('file:progress', {
        transferId: chunkPayload.transferId,
        received: t.received,
        total: t.total,
        direction: 'download',
      })
      if (t.received >= t.total) {
        t.writeStream.end()
        activeTransfers.delete(chunkPayload.transferId)
        win.webContents.send('file:complete', { transferId: chunkPayload.transferId, savePath: t.savePath })
      }
    }
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('network:local', { peerId, nickname: initialNickname })
  })

  network.start()

  // IPC handlers
  ipcMain.handle('app:get-config', () => loadConfig())
  ipcMain.handle('app:set-nickname', (_, nickname: string) => {
    saveConfig({ nickname })
    if (network) {
      network.updateNickname(nickname)
    }
    win.webContents.send('network:local', { peerId, nickname })
  })

  ipcMain.handle('net:create-room', (_, name: string, type: 'public' | 'private', password?: string) => {
    const room = network?.createRoom(name, type, password)
    if (!room) return null
    return { ...room, members: Array.from(room.members) }
  })
  ipcMain.handle('net:join-room', (_, roomId: string, password?: string, name?: string, type?: 'public' | 'private') => {
    network?.joinRoom(roomId, password, name, type)
  })
  ipcMain.handle('net:send-text', (_, roomId: string, content: string) => {
    network?.sendText(roomId, content)
  })
  ipcMain.handle('net:get-peers', () => {
    return network?.getPeers() ?? []
  })
  ipcMain.handle('net:get-rooms', () => {
    return (network?.getRooms() ?? []).map((r) => ({ ...r, members: Array.from(r.members) }))
  })

  // Manual peer connection
  ipcMain.handle('net:connect-peer', async (_, ip: string, port: number) => {
    network?.connectPeer(ip, port)
  })

  // File transfer: sender side
  ipcMain.handle('net:offer-file', async (_, peerIdArg: string) => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    const transferId = randomUUID()
    network?.offerFile(peerIdArg, path.basename(filePath), stat.size, 'application/octet-stream')
    activeTransfers.set(transferId, { filePath, received: 0, total: stat.size, peerId: peerIdArg })

    // start sending chunks after a short delay to let receiver accept
    setTimeout(() => sendFileChunks(transferId, peerIdArg, filePath, stat.size), 600)

    return { transferId, fileName: path.basename(filePath), size: stat.size }
  })

  // File transfer: receiver side setup
  ipcMain.handle('net:accept-file', async (_, peerIdArg: string, transferId: string, fileName: string) => {
    const result = await dialog.showSaveDialog(win, { defaultPath: fileName })
    if (result.canceled || !result.filePath) return null
    const writeStream = fs.createWriteStream(result.filePath)
    activeTransfers.set(transferId, {
      savePath: result.filePath,
      writeStream,
      received: 0,
      total: 0,
      peerId: peerIdArg,
    })
    return { transferId, savePath: result.filePath }
  })

  // Cancel transfer
  ipcMain.handle('net:cancel-transfer', (_, transferId: string) => {
    const t = activeTransfers.get(transferId)
    if (t?.writeStream) {
      t.writeStream.destroy()
      if (t.savePath) {
        try { fs.unlinkSync(t.savePath) } catch {}
      }
    }
    activeTransfers.delete(transferId)
  })

  // Shared folder
  ipcMain.handle('app:set-shared-folder', async (_, explicitPath?: string | null) => {
    if (explicitPath === null) {
      saveConfig({ sharedPath: '' })
      network?.setSharedPath(null)
      return null
    }
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const folderPath = result.filePaths[0]
    saveConfig({ sharedPath: folderPath })
    network?.setSharedPath(folderPath)
    return folderPath
  })
  ipcMain.handle('app:get-shared-folder', () => {
    return loadConfig().sharedPath || null
  })

  // List peer shared files
  ipcMain.handle('net:list-peer-files', async (_, ip: string, discoveryPort: number) => {
    try {
      const data = await httpGet(`http://${ip}:${discoveryPort}/whisper/share`, 3000)
      return JSON.parse(data)
    } catch {
      return null
    }
  })

  // Download multiple files from peer
  ipcMain.handle('net:download-peer-files', async (_, ip: string, discoveryPort: number, files: string[], destDir: string) => {
    const downloads: { fileName: string; status: 'ok' | 'error' }[] = []
    for (const fileName of files) {
      try {
        await downloadFile(ip, discoveryPort, fileName, path.join(destDir, fileName))
        downloads.push({ fileName, status: 'ok' })
      } catch {
        downloads.push({ fileName, status: 'error' })
      }
    }
    return downloads
  })

  return win
}

async function sendFileChunks(transferId: string, peerId: string, filePath: string, totalSize: number) {
  const CHUNK_SIZE = 64 * 1024 // 64KB
  const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE })
  let index = 0
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
  let sent = 0

  for await (const chunk of stream) {
    network?.sendFileChunk(peerId, transferId, chunk, index, totalChunks)
    sent += chunk.length
    index++
    mainWin?.webContents.send('file:progress', {
      transferId,
      received: sent,
      total: totalSize,
      direction: 'upload',
    })
    // small delay to avoid flooding
    await new Promise((r) => setTimeout(r, 5))
  }

  mainWin?.webContents.send('file:complete', { transferId, filePath })
  activeTransfers.delete(transferId)
}

function httpGet(url: string, timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = require('http').get(url, { timeout }, (res: any) => {
      let data = ''
      res.on('data', (c: any) => (data += c))
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function downloadFile(ip: string, port: number, fileName: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const url = `http://${ip}:${port}/whisper/share/${encodeURIComponent(fileName)}`
    const req = require('http').get(url, { timeout: 30000 }, (res: any) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Status ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    })
    req.on('error', (err: any) => {
      fs.unlink(destPath, () => {})
      reject(err)
    })
    req.on('timeout', () => {
      req.destroy()
      fs.unlink(destPath, () => {})
      reject(new Error('timeout'))
    })
  })
}

app.whenReady().then(() => {
  const cfg = loadConfig()
  const nickname = cfg.nickname || ''
  createWindow(nickname)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(nickname)
    }
  })
})

app.on('window-all-closed', () => {
  for (const t of activeTransfers.values()) {
    if (t.writeStream) t.writeStream.destroy()
  }
  activeTransfers.clear()
  network?.stop()
  if (process.platform !== 'darwin') app.quit()
})
