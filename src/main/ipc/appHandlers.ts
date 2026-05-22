import { app, dialog, ipcMain, nativeImage, shell } from 'electron'
import { loadConfig, saveConfig } from '../utils/config'
import { ipcState, sendToRenderer } from './context'

export function registerAppHandlers() {
  ipcMain.handle('app:set-badge-count', (_, count: number) => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(count > 0 ? String(count) : '')
    }
    if (process.platform === 'linux') {
      app.setBadgeCount(count > 0 ? count : 0)
    }
  })

  ipcMain.handle('app:set-badge-overlay', (_, dataUrl: string | null) => {
    const win = ipcState.mainWin
    if (process.platform === 'win32' && win && !win.isDestroyed()) {
      if (dataUrl) {
        const icon = nativeImage.createFromDataURL(dataUrl)
        win.setOverlayIcon(icon, 'Unread messages')
      } else {
        win.setOverlayIcon(null, '')
      }
    }
  })

  ipcMain.handle('app:get-config', () => loadConfig())
  ipcMain.handle('app:get-version', () => ipcState.appVersion)
  ipcMain.handle('app:get-local-info', () => ({
    ip: ipcState.network?.getLocalIp() ?? '127.0.0.1',
    tcpPort: ipcState.network?.getTcpPort() ?? 0,
    discoveryPort: ipcState.network?.getDiscoveryPort() ?? 0,
  }))

  ipcMain.handle('app:set-nickname', (_, nickname: string) => {
    saveConfig({ nickname })
    ipcState.network?.updateNickname(nickname)
    sendToRenderer('network:local', { peerId: ipcState.peerId, nickname })
  })

  ipcMain.handle('app:set-shared-folder', async (_, explicitPath?: string | null) => {
    const win = ipcState.mainWin
    if (!win) return null

    if (explicitPath === null) {
      saveConfig({ sharedPath: '' })
      ipcState.network?.setSharedPath(null)
      return null
    }
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    const folderPath = result.filePaths[0]
    saveConfig({ sharedPath: folderPath })
    ipcState.network?.setSharedPath(folderPath)
    return folderPath
  })

  ipcMain.handle('app:get-shared-folder', () => loadConfig().sharedPath || null)

  ipcMain.handle('app:set-room-mute', (_, roomId: string, muted: boolean) => {
    if (muted) ipcState.mutedRoomIds.add(roomId)
    else ipcState.mutedRoomIds.delete(roomId)
  })

  ipcMain.handle('app:get-room-mute', (_, roomId: string) => ipcState.mutedRoomIds.has(roomId))

  ipcMain.handle('app:set-notification-preview', (_, value: boolean) => {
    ipcState.showNotificationPreview = value
    saveConfig({ showNotificationPreview: value })
  })

  ipcMain.handle('app:select-download-folder', async () => {
    const win = ipcState.mainWin
    if (!win) return null
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
}
