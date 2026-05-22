import { dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID, createHash } from 'crypto'
import { downloadFile, downloadRoomAttachment, httpGet } from '../utils/http'
import { ipcState, sendToRenderer } from './context'

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'image/webp':
      return '.webp'
    case 'image/bmp':
      return '.bmp'
    default:
      return '.png'
  }
}

const GENERIC_CLIPBOARD_IMAGE_NAME = /^image\.(png|jpe?g|gif|webp|bmp)$/i

function uniqueClipboardFileName(mimeType: string, suggestedName?: string): string {
  const ext = extensionForMime(mimeType)
  const trimmed = suggestedName?.trim()
  if (trimmed && !GENERIC_CLIPBOARD_IMAGE_NAME.test(trimmed)) {
    return path.extname(trimmed) ? trimmed : `${trimmed}${ext}`
  }
  return `clipboard-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`
}

function getSharedPathOrError(): string | { error: string } {
  const sharedPath = ipcState.network?.getSharedPath() || ipcState.initialSharedPath
  if (!sharedPath) {
    return { error: '공유 폴터가 설정되지 않았습니다.' }
  }
  return sharedPath
}

function sendPreparedRoomAttachment(
  roomId: string,
  fileName: string,
  sourcePath: string,
  messageId: string
) {
  const stat = fs.statSync(sourcePath)
  const checksum = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')
  const dataUrl = imageDataUrl(sourcePath)

  ipcState.network?.sendFileAttachment(
    roomId,
    fileName,
    stat.size,
    checksum,
    messageId,
    sourcePath,
    dataUrl
  )

  return {
    messageId,
    fileName,
    fileSize: stat.size,
    checksum,
    localPath: sourcePath,
    dataUrl,
  }
}

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
    if (stat.size > MAX_ATTACHMENT_SIZE) {
      return { error: '10MB 초과. 공유 폴터를 이용해주세요.' }
    }

    const sharedPath = getSharedPathOrError()
    if (typeof sharedPath !== 'string') return sharedPath

    const messageId = randomUUID()
    const destDir = path.join(sharedPath, '_roomsFiles', roomId, messageId)
    fs.mkdirSync(destDir, { recursive: true })
    const destPath = path.join(destDir, path.basename(filePath))
    fs.copyFileSync(filePath, destPath)

    return sendPreparedRoomAttachment(roomId, path.basename(filePath), destPath, messageId)
  })

  ipcMain.handle(
    'net:send-file-attachment-from-data',
    async (
      _,
      roomId: string,
      payload: { fileName?: string; mimeType: string; dataBase64: string }
    ) => {
      const buffer = Buffer.from(payload.dataBase64, 'base64')
      if (buffer.length > MAX_ATTACHMENT_SIZE) {
        return { error: '10MB 초과. 공유 폴터를 이용해주세요.' }
      }
      if (!payload.mimeType.startsWith('image/')) {
        return { error: '이미지 파일만 붙여넣을 수 있습니다.' }
      }

      const sharedPath = getSharedPathOrError()
      if (typeof sharedPath !== 'string') return sharedPath

      const fileName = uniqueClipboardFileName(payload.mimeType, payload.fileName)
      const messageId = randomUUID()
      const destDir = path.join(sharedPath, '_roomsFiles', roomId, messageId)
      fs.mkdirSync(destDir, { recursive: true })
      const destPath = path.join(destDir, fileName)
      fs.writeFileSync(destPath, buffer)

      return sendPreparedRoomAttachment(roomId, fileName, destPath, messageId)
    }
  )

  ipcMain.handle(
    'net:download-attachment',
    async (
      _,
      roomId: string,
      messageId: string,
      fileName: string,
      senderIp: string,
      senderDiscoveryPort: number,
      senderPeerId?: string
    ) => {
      const sharedPath = ipcState.network?.getSharedPath() || ipcState.initialSharedPath
      if (!sharedPath) {
        return { error: '공유 폴터가 설정되지 않았습니다.' }
      }

      let ip = senderIp
      let port = senderDiscoveryPort
      if (senderPeerId) {
        await ipcState.network?.refreshPeer(senderPeerId)
        const peer = ipcState.network?.getPeers().find((p) => p.peerId === senderPeerId)
        if (peer?.ip) ip = peer.ip
        if (peer?.discoveryPort) port = peer.discoveryPort
      }

      const safeFileName = path.basename(fileName)
      const destDir = path.join(sharedPath, '_roomsFiles', roomId, messageId)
      fs.mkdirSync(destDir, { recursive: true })
      const destPath = path.join(destDir, safeFileName)
      const remotePath = `_roomsFiles/${roomId}/${messageId}/${safeFileName}`

      const tryDownload = async () => {
        try {
          await downloadFile(ip, port, remotePath, destPath)
          return true
        } catch {
          try {
            await downloadRoomAttachment(ip, port, roomId, messageId, safeFileName, destPath)
            return true
          } catch {
            return false
          }
        }
      }

      try {
        const ok = await tryDownload()
        if (!ok) {
          return { error: '다운로드 실패 (404)' }
        }
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
