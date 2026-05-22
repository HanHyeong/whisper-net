import { ipcMain, shell } from 'electron'
import { ipcState, sendToRenderer } from './context'
import { UpdateChannel } from '../update/types'

export function registerUpdateHandlers() {
  ipcMain.handle('update:check', async (_, channel?: UpdateChannel) => {
    const service = ipcState.updateService
    if (!service) {
      return {
        status: 'error',
        currentVersion: ipcState.appVersion,
        channel: channel ?? 'stable',
        message: '업데이트 서비스를 사용할 수 없습니다.',
      }
    }
    return service.checkForUpdates(channel)
  })

  ipcMain.handle('update:download', async () => {
    const service = ipcState.updateService
    if (!service) return { ok: false, message: '업데이트 서비스를 사용할 수 없습니다.' }
    return service.downloadUpdate()
  })

  ipcMain.handle('update:open-installer', async (_, installerPath: string) => {
    if (!installerPath || typeof installerPath !== 'string') {
      return { ok: false, message: '설치 파일 경로가 없습니다.' }
    }
    await shell.openPath(installerPath)
    return { ok: true }
  })

  ipcMain.handle('update:get-settings', () => {
    return ipcState.updateService?.getSettings() ?? null
  })
}

export function setupUpdateEvents() {
  const service = ipcState.updateService
  if (!service) return

  service.on('progress', (progress) => sendToRenderer('update:progress', progress))
  service.on('available', (result) => sendToRenderer('update:available', result))
}
