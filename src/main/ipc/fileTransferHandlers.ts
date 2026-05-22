import { dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID, createHash } from 'crypto'
import { downloadFile, httpGet } from '../utils/http'
import { ipcState, sendToRenderer } from './context'

function imageDataUrl(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return undefined
  const buf = fs.readFileSync(filePath)
  const mime =
    ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function sendFileChunks(transferId: string, peerId: string, filePath: string, totalSize: number) {
  const CHUNK_SIZE = 64 * 1024
  const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE })
  let index = 0
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
  let sent = 0

  for await (const chunk of stream) {
    ipcState.network?.sendFileChunk(peerId, transferId, chunk, index, totalChunks)
    sent += chunk.length
    index++
    sendToRenderer('file:progress', {
      transferId,
      received: sent,
      total: totalSize,
      direction: 'upload',
    })
    await new Promise((r) => setTimeout(r, 5))
  }

  sendToRenderer('file:complete', { transferId, filePath })
  ipcState.activeTransfers.delete(transferId)
}

export function registerFileTransferHandlers() {
  ipcMain.handle('net:send-file-attachment', async (_, roomId: string) => {
    const win = ipcState.mainWin
    if (!win) return null

    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    const MAX_SIZE = 10 * 1024 * 1024
    if (stat.size > MAX_SIZE) {
      return { error: '10MB 초과. 공유 폴터를 이용해주세요.' }
    }

    const sharedPath = ipcState.network?.getSharedPath() || ipcState.initialSharedPath
    if (!sharedPath) {
      return { error: '공유 폴터가 설정되지 않았습니다.' }
    }

    const messageId = randomUUID()
    const destDir = path.join(sharedPath, '_roomsFiles', roomId, messageId)
    fs.mkdirSync(destDir, { recursive: true })
    const destPath = path.join(destDir, path.basename(filePath))
    fs.copyFileSync(filePath, destPath)
    const checksum = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    const dataUrl = imageDataUrl(destPath)

    ipcState.network?.sendFileAttachment(
      roomId,
      path.basename(filePath),
      stat.size,
      checksum,
      messageId,
      destPath,
      dataUrl
    )

    return {
      messageId,
      fileName: path.basename(filePath),
      fileSize: stat.size,
      checksum,
      localPath: destPath,
      dataUrl,
    }
  })

  ipcMain.handle(
    'net:download-attachment',
    async (
      _,
      roomId: string,
      messageId: string,
      fileName: string,
      senderIp: string,
      senderDiscoveryPort: number
    ) => {
      const sharedPath = ipcState.network?.getSharedPath() || ipcState.initialSharedPath
      if (!sharedPath) {
        return { error: '공유 폴터가 설정되지 않았습니다.' }
      }
      const destDir = path.join(sharedPath, '_roomsFiles', roomId, messageId)
      fs.mkdirSync(destDir, { recursive: true })
      const destPath = path.join(destDir, fileName)
      const remotePath = `_roomsFiles/${roomId}/${messageId}/${fileName}`
      try {
        await downloadFile(senderIp, senderDiscoveryPort, remotePath, destPath)
        const result: { localPath: string; dataUrl?: string } = { localPath: destPath }
        result.dataUrl = imageDataUrl(destPath)
        return result
      } catch (err: any) {
        return { error: err.message || '다운로드 실패' }
      }
    }
  )

  ipcMain.handle('net:offer-file', async (_, peerIdArg: string) => {
    const win = ipcState.mainWin
    if (!win) return null

    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const stat = fs.statSync(filePath)
    const transferId = randomUUID()
    ipcState.network?.offerFile(peerIdArg, path.basename(filePath), stat.size, 'application/octet-stream')
    ipcState.activeTransfers.set(transferId, { filePath, received: 0, total: stat.size, peerId: peerIdArg })

    setTimeout(() => sendFileChunks(transferId, peerIdArg, filePath, stat.size), 600)

    return { transferId, fileName: path.basename(filePath), size: stat.size }
  })

  ipcMain.handle('net:accept-file', async (_, peerIdArg: string, transferId: string, fileName: string) => {
    const win = ipcState.mainWin
    if (!win) return null

    const result = await dialog.showSaveDialog(win, { defaultPath: fileName })
    if (result.canceled || !result.filePath) return null

    const writeStream = fs.createWriteStream(result.filePath)
    ipcState.activeTransfers.set(transferId, {
      savePath: result.filePath,
      writeStream,
      received: 0,
      total: 0,
      peerId: peerIdArg,
    })
    return { transferId, savePath: result.filePath }
  })

  ipcMain.handle('net:cancel-transfer', (_, transferId: string) => {
    const t = ipcState.activeTransfers.get(transferId)
    if (t?.writeStream) {
      t.writeStream.destroy()
      if (t.savePath) {
        try {
          fs.unlinkSync(t.savePath)
        } catch {}
      }
    }
    ipcState.activeTransfers.delete(transferId)
  })

  ipcMain.handle('net:list-peer-files', async (_, ip: string, discoveryPort: number, relativePath?: string) => {
    try {
      const qs = relativePath ? `?path=${encodeURIComponent(relativePath)}` : ''
      const data = await httpGet(`http://${ip}:${discoveryPort}/whisper/share${qs}`, 3000)
      return JSON.parse(data)
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'net:download-peer-files',
    async (_, ip: string, discoveryPort: number, files: string[], destDir: string, basePath?: string) => {
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
    }
  )
}

export function cleanupActiveTransfers() {
  for (const t of ipcState.activeTransfers.values()) {
    if (t.writeStream) t.writeStream.destroy()
  }
  ipcState.activeTransfers.clear()
}
