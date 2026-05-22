import { app, Menu, nativeImage, Notification, Tray } from 'electron'
import path from 'path'
import { ipcState } from './ipc/context'

const isDev = !app.isPackaged
let tray: Tray | null = null
let unreadMessageCount = 0

export function createTray(onQuit: () => void) {
  if (tray) return

  const iconPath = isDev
    ? path.join(__dirname, '../../build/icon.png')
    : path.join(process.resourcesPath, 'app.asar', 'build', 'icon.png')

  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty()
  }
  icon = icon.resize({ width: 22, height: 22 })

  tray = new Tray(icon)
  tray.setToolTip('Whisper Net')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Whisper Net 열기',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: '종료',
      click: onQuit,
    },
  ])

  if (process.platform === 'darwin') {
    tray.on('click', () => showMainWindow())
    tray.on('right-click', () => tray!.popUpContextMenu(contextMenu))
  } else {
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => showMainWindow())
  }
}

export function showMainWindow() {
  const win = ipcState.mainWin
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show()
    }
  }
}

export function updateTrayTooltip(count: number) {
  if (tray) {
    tray.setToolTip(count > 0 ? `Whisper Net (${count} unread)` : 'Whisper Net')
  }
}

export function resetUnreadCount() {
  unreadMessageCount = 0
  updateTrayTooltip(0)
}

export function notifyUnreadMessage(msg: {
  roomId: string
  content?: string
  nickname?: string
  senderName?: string
  payload?: { content?: string }
}) {
  const win = ipcState.mainWin
  if (!win || win.isDestroyed() || win.isFocused() || ipcState.mutedRoomIds.has(msg.roomId)) return

  if (process.platform === 'win32') {
    win.flashFrame(true)
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.bounce('informational')
  }

  unreadMessageCount++
  showMessageNotification(msg)
  updateTrayTooltip(unreadMessageCount)
}

function isPrivateRoom(roomId: string): boolean {
  const room = ipcState.network?.getRooms().find((r) => r.roomId === roomId)
  return room?.type === 'private'
}

function showMessageNotification(msg: {
  roomId: string
  content?: string
  nickname?: string
  senderName?: string
  payload?: { content?: string }
}) {
  if (!Notification.isSupported()) return

  const senderName = msg.senderName || msg.nickname || '알 수 없음'
  const title = senderName
  let body = '새 메시지가 도착했습니다.'

  if (isPrivateRoom(msg.roomId)) {
    body = `비밀메시지 (${senderName})`
  } else if (ipcState.showNotificationPreview) {
    if (typeof msg.content === 'string' && msg.content) {
      body = msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content
    } else if (typeof msg.payload?.content === 'string' && msg.payload.content) {
      body =
        msg.payload.content.length > 60 ? msg.payload.content.slice(0, 60) + '…' : msg.payload.content
    }
  }

  const notification = new Notification({ title, body })
  notification.on('click', () => showMainWindow())
  notification.show()
}

export function clearFlashOnFocus() {
  const win = ipcState.mainWin
  if (win && !win.isDestroyed() && process.platform === 'win32') {
    win.flashFrame(false)
  }
}
