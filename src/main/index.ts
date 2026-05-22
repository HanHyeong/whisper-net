import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { NetworkManager } from './network/NetworkManager'
import { loadConfig } from './utils/config'
import { ipcState, sendToRenderer } from './ipc/context'
import { registerAppHandlers } from './ipc/appHandlers'
import { registerNetworkHandlers, setupNetworkEvents } from './ipc/networkHandlers'
import { cleanupActiveTransfers, registerFileTransferHandlers } from './ipc/fileTransferHandlers'
import { clearFlashOnFocus, createTray, notifyUnreadMessage, resetUnreadCount } from './tray'

const packageJsonPath = path.join(__dirname, '../../package.json')
const appVersion = fs.existsSync(packageJsonPath)
  ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version
  : '0.0.0'

const isE2E = process.env.WHISPER_E2E === '1'
const isDev = !app.isPackaged && !isE2E
let isQuitting = false

const canStartApp =
  isE2E ||
  (() => {
    const gotSingleInstanceLock = app.requestSingleInstanceLock()
    if (!gotSingleInstanceLock) {
      app.quit()
      return false
    }
    app.on('second-instance', () => {
      const win = ipcState.mainWin
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        if (process.platform === 'darwin' && app.dock) {
          app.dock.show()
        }
      }
    })
    return true
  })()

function registerIpcHandlers(initialNickname: string) {
  if (ipcState.handlersRegistered) return
  ipcState.handlersRegistered = true
  registerAppHandlers()
  registerNetworkHandlers(initialNickname)
  registerFileTransferHandlers()
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

  ipcState.mainWin = win
  ipcState.initialSharedPath = initialSharedPath
  ipcState.appVersion = appVersion
  ipcState.showNotificationPreview = loadConfig().showNotificationPreview ?? true

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  const peerId = randomUUID()
  ipcState.peerId = peerId

  ipcState.network?.stop()
  const network = new NetworkManager({ peerId, nickname: initialNickname, tcpPort: 41235 + Math.floor(Math.random() * 1000) })
  ipcState.network = network

  registerIpcHandlers(initialNickname)
  setupNetworkEvents(network, notifyUnreadMessage)

  win.webContents.on('did-finish-load', () => {
    sendToRenderer('network:local', { peerId, nickname: initialNickname })
  })

  network.start()

  if (initialSharedPath) {
    network.setSharedPath(initialSharedPath)
    const roomsFilesPath = path.join(initialSharedPath, '_roomsFiles')
    try {
      fs.rmSync(roomsFilesPath, { recursive: true, force: true })
    } catch {}
  }

  win.on('close', (event) => {
    if (!isQuitting && !isE2E) {
      event.preventDefault()
      win.hide()
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide()
      }
    }
  })

  win.on('show', () => resetUnreadCount())
  win.on('closed', () => {
    ipcState.mainWin = null
  })
  win.on('focus', () => clearFlashOnFocus())

  if (!isE2E) {
    createTray(() => {
      isQuitting = true
      app.quit()
    })
  }

  return win
}

if (canStartApp) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    const cfg = loadConfig()
    createWindow(cfg.nickname || '', cfg.sharedPath)

    app.on('activate', () => {
      if (ipcState.mainWin && !ipcState.mainWin.isDestroyed()) {
        ipcState.mainWin.show()
        ipcState.mainWin.focus()
        if (process.platform === 'darwin' && app.dock) {
          app.dock.show()
        }
      } else {
        createWindow(cfg.nickname || '', cfg.sharedPath)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (isE2E) app.quit()
    // Keep app running in tray on Windows/Linux
  })

  app.on('before-quit', () => {
    isQuitting = true
    cleanupActiveTransfers()

    const cfg = loadConfig()
    if (cfg.sharedPath) {
      const roomsFilesPath = path.join(cfg.sharedPath, '_roomsFiles')
      try {
        fs.rmSync(roomsFilesPath, { recursive: true, force: true })
      } catch {}
    }
    ipcState.network?.stop()
  })
}
