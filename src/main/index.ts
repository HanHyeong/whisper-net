import { app, shell, BrowserWindow, ipcMain, dialog, Menu, nativeImage, Tray, Notification } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID, createHash } from 'crypto'
import { NetworkManager } from './network/NetworkManager'
import { loadConfig, saveConfig } from './utils/config'

// Read version from package.json
const packageJsonPath = path.join(__dirname, '../../package.json')
const appVersion = fs.existsSync(packageJsonPath)
  ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version
  : '0.0.0'

const isDev = !app.isPackaged
let network: NetworkManager | null = null
let mainWin: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let unreadMessageCount = 0
const mutedRoomIds = new Set<string>()

// Badge handlers (registered once globally to avoid duplicate registration)
ipcMain.handle('app:set-badge-count', (_, count: number) => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(count > 0 ? String(count) : '')
  }
  if (process.platform === 'linux') {
    app.setBadgeCount(count > 0 ? count : 0)
  }
})
ipcMain.handle('app:set-badge-overlay', (_, dataUrl: string | null) => {
  if (process.platform === 'win32' && mainWin && !mainWin.isDestroyed()) {
    if (dataUrl) {
      const icon = nativeImage.createFromDataURL(dataUrl)
      mainWin.setOverlayIcon(icon, 'Unread messages')
    } else {
      mainWin.setOverlayIcon(null, '')
    }
  }
})

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

function createTray() {
  if (tray) return

  const iconPath = isDev
    ? path.join(__dirname, '../../build/icon.png')
    : path.join(process.resourcesPath, 'app.asar', 'build', 'icon.png')

  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty()
  }
  icon = icon.resize({ width: 22, height: 22 })
  // Colored icon on all platforms (no template) so the brand gradient shows

  tray = new Tray(icon)
  tray.setToolTip('Whisper Net')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Whisper Net 열기',
      click: () => {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.show()
          mainWin.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  if (process.platform === 'darwin') {
    // macOS: left-click restores window, right-click shows menu
    tray.on('click', () => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.show()
        mainWin.focus()
      }
    })
    tray.on('right-click', () => {
      tray!.popUpContextMenu(contextMenu)
    })
  } else {
    // Windows/Linux: context menu + double-click to restore
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.show()
        mainWin.focus()
      }
    })
  }
}

function updateTrayTooltip(count: number) {
  if (tray) {
    tray.setToolTip(count > 0 ? `Whisper Net (${count} unread)` : 'Whisper Net')
  }
}

function showMessageNotification(msg: any) {
  if (!Notification.isSupported()) return
  const title = msg.nickname || 'Whisper Net'
  let body = '새 메시지가 도착했습니다.'
  if (typeof msg.content === 'string' && msg.content) {
    body = msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content
  } else if (typeof msg.payload?.content === 'string' && msg.payload.content) {
    body = msg.payload.content.length > 60 ? msg.payload.content.slice(0, 60) + '…' : msg.payload.content
  }
  const notification = new Notification({ title, body })
  notification.on('click', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show()
      mainWin.focus()
    }
  })
  notification.show()
}

function createWindow(initialNickname: string, initialSharedPath?: string) {
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

  // Guard against sending to destroyed window (app quit race condition on Windows)
  const sendToRenderer = (channel: string, ...args: any[]) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }

  network.on('peers', (peers) => {
    sendToRenderer('network:peers', peers)
  })
  network.on('rooms', (rooms) => {
    sendToRenderer('network:rooms', rooms)
  })
  network.on('message', (msg) => {
    sendToRenderer('network:message', msg)
    // Flash taskbar (Windows) or bounce dock (macOS) when not focused
    if (!win.isDestroyed() && !win.isFocused() && !mutedRoomIds.has(msg.roomId)) {
      if (process.platform === 'win32') {
        win.flashFrame(true)
      }
      if (process.platform === 'darwin' && app.dock) {
        app.dock.bounce('informational')
      }
      // Notify when not focused (hidden or background)
      unreadMessageCount++
      showMessageNotification(msg)
      updateTrayTooltip(unreadMessageCount)
    }
  })
  network.on('file:offer', (offer) => {
    sendToRenderer('network:file:offer', offer)
  })
  network.on('file:chunk', (chunkPayload) => {
    const t = activeTransfers.get(chunkPayload.transferId)
    if (t && t.savePath && t.writeStream) {
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
        activeTransfers.delete(chunkPayload.transferId)
        sendToRenderer('file:complete', { transferId: chunkPayload.transferId, savePath: t.savePath })
      }
    }
  })

  win.webContents.on('did-finish-load', () => {
    sendToRenderer('network:local', { peerId, nickname: initialNickname })
  })
  // Fallback: Windows may fire did-finish-load before renderer listener is ready
  ipcMain.once('app:renderer-ready', () => {
    sendToRenderer('network:local', { peerId, nickname: initialNickname })
    // Trigger a refresh on startup so renderer gets latest peer/room data
    // (same as user pressing the refresh button)
    network?.refreshPeers().catch(() => {})
  })

  network.start()

  // Auto-load shared folder from config on startup
  if (initialSharedPath) {
    network.setSharedPath(initialSharedPath)
    // Clean up room files on startup (ephemeral)
    const roomsFilesPath = path.join(initialSharedPath, '_roomsFiles')
    try {
      fs.rmSync(roomsFilesPath, { recursive: true, force: true })
    } catch {}
  }

  // IPC handlers
  ipcMain.handle('app:get-config', () => loadConfig())
  ipcMain.handle('app:get-version', () => appVersion)
  ipcMain.handle('app:get-local-info', () => ({
    ip: network?.getLocalIp() ?? '127.0.0.1',
    tcpPort: network?.getTcpPort() ?? 0,
    discoveryPort: network?.getDiscoveryPort() ?? 0,
  }))
  ipcMain.handle('app:set-nickname', (_, nickname: string) => {
    saveConfig({ nickname })
    if (network) {
      network.updateNickname(nickname)
    }
    sendToRenderer('network:local', { peerId, nickname })
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

  // File attachment via shared folder (max 10MB)
  ipcMain.handle('net:send-file-attachment', async (_, roomId: string) => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    const MAX_SIZE = 10 * 1024 * 1024
    if (stat.size > MAX_SIZE) {
      return { error: '10MB 초과. 공유 폴터를 이용해주세요.' }
    }
    const sharedPath = network?.getSharedPath() || initialSharedPath
    if (!sharedPath) {
      return { error: '공유 폴터가 설정되지 않았습니다.' }
    }
    const messageId = randomUUID()
    const destDir = path.join(sharedPath, '_roomsFiles', roomId, messageId)
    fs.mkdirSync(destDir, { recursive: true })
    const destPath = path.join(destDir, path.basename(filePath))
    fs.copyFileSync(filePath, destPath)
    const checksum = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')

    // Generate data URL for images so sender sees thumbnail immediately
    let dataUrl: string | undefined
    const ext = path.extname(filePath).toLowerCase()
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
      const buf = fs.readFileSync(destPath)
      const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      dataUrl = `data:${mime};base64,${buf.toString('base64')}`
    }

    network?.sendFileAttachment(roomId, path.basename(filePath), stat.size, checksum, messageId, destPath, dataUrl)
    return {
      messageId,
      fileName: path.basename(filePath),
      fileSize: stat.size,
      checksum,
      localPath: destPath,
      dataUrl,
    }
  })

  // Download attachment from peer's shared folder
  ipcMain.handle('net:download-attachment', async (_, roomId: string, messageId: string, fileName: string, senderIp: string, senderDiscoveryPort: number) => {
    const sharedPath = network?.getSharedPath() || initialSharedPath
    if (!sharedPath) {
      return { error: '공유 폴터가 설정되지 않았습니다.' }
    }
    const destDir = path.join(sharedPath, '_roomsFiles', roomId, messageId)
    fs.mkdirSync(destDir, { recursive: true })
    const destPath = path.join(destDir, fileName)
    const remotePath = `_roomsFiles/${roomId}/${messageId}/${fileName}`
    try {
      await downloadFile(senderIp, senderDiscoveryPort, remotePath, destPath)
      const result: any = { localPath: destPath }
      // Convert image to data URL for inline display
      const ext = path.extname(fileName).toLowerCase()
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
        const buf = fs.readFileSync(destPath)
        const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
        result.dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      }
      return result
    } catch (err: any) {
      return { error: err.message || '다운로드 실패' }
    }
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
  ipcMain.handle('net:refresh-peers', async () => {
    return network?.refreshPeers() ?? 0
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
  ipcMain.handle('app:set-room-mute', (_, roomId: string, muted: boolean) => {
    if (muted) mutedRoomIds.add(roomId)
    else mutedRoomIds.delete(roomId)
  })
  ipcMain.handle('app:get-room-mute', (_, roomId: string) => {
    return mutedRoomIds.has(roomId)
  })
  ipcMain.handle('app:select-download-folder', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  ipcMain.handle('app:open-file', (_, filePath: string) => {
    shell.openPath(filePath)
  })
  ipcMain.handle('app:show-in-folder', (_, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // List peer shared files
  ipcMain.handle('net:list-peer-files', async (_, ip: string, discoveryPort: number, relativePath?: string) => {
    try {
      const qs = relativePath ? `?path=${encodeURIComponent(relativePath)}` : ''
      const data = await httpGet(`http://${ip}:${discoveryPort}/whisper/share${qs}`, 3000)
      return JSON.parse(data)
    } catch {
      return null
    }
  })

  // Download multiple files from peer
  ipcMain.handle('net:download-peer-files', async (_, ip: string, discoveryPort: number, files: string[], destDir: string, basePath?: string) => {
    const downloads: { fileName: string; status: 'ok' | 'error' }[] = []
    for (const fileName of files) {
      try {
        const remotePath = basePath ? `${basePath}/${fileName}` : fileName
        await downloadFile(ip, discoveryPort, remotePath, path.join(destDir, fileName))
        downloads.push({ fileName, status: 'ok' })
      } catch {
        downloads.push({ fileName, status: 'error' })
      }
    }
    return downloads
  })

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide()
      }
    }
  })

  win.on('show', () => {
    unreadMessageCount = 0
    updateTrayTooltip(0)
  })

  win.on('closed', () => {
    mainWin = null
  })

  if (!tray) {
    createTray()
  }

  win.on('focus', () => {
    if (process.platform === 'win32') {
      win.flashFrame(false)
    }
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
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('file:progress', {
        transferId,
        received: sent,
        total: totalSize,
        direction: 'upload',
      })
    }
    // small delay to avoid flooding
    await new Promise((r) => setTimeout(r, 5))
  }

  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('file:complete', { transferId, filePath })
  }
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
  // Remove default menu bar (File, Edit, View, etc.) — not needed for this app
  Menu.setApplicationMenu(null)

  const cfg = loadConfig()
  const nickname = cfg.nickname || ''
  createWindow(nickname, cfg.sharedPath)

  app.on('activate', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.show()
      mainWin.focus()
      if (process.platform === 'darwin' && app.dock) {
        app.dock.show()
      }
    } else {
      createWindow(nickname, cfg.sharedPath)
    }
  })
})

app.on('window-all-closed', () => {
  // Keep app running in tray on Windows/Linux; macOS stays alive by default
})

app.on('before-quit', () => {
  isQuitting = true
  for (const t of activeTransfers.values()) {
    if (t.writeStream) t.writeStream.destroy()
  }
  activeTransfers.clear()
  // Clean up room files on exit
  const cfg = loadConfig()
  if (cfg.sharedPath) {
    const roomsFilesPath = path.join(cfg.sharedPath, '_roomsFiles')
    try {
      fs.rmSync(roomsFilesPath, { recursive: true, force: true })
    } catch {}
  }
  network?.stop()
})
