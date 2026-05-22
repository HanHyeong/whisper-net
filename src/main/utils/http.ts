import http from 'http'
import fs from 'fs'

export function httpGet(url: string, timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

export function downloadFile(ip: string, port: number, fileName: string, destPath: string): Promise<void> {
  const encodedPath = fileName.split('/').map(encodeURIComponent).join('/')
  return downloadBinary(`http://${ip}:${port}/whisper/share/${encodedPath}`, destPath)
}

export function downloadRoomAttachment(
  ip: string,
  port: number,
  roomId: string,
  messageId: string,
  fileName: string,
  destPath: string
): Promise<void> {
  const qs = new URLSearchParams({ roomId, messageId, fileName })
  return downloadBinary(`http://${ip}:${port}/whisper/room-attachment?${qs.toString()}`, destPath)
}

export function downloadBinary(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const req = http.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode !== 200) {
        file.close()
        fs.unlink(destPath, () => {})
        reject(new Error(`Status ${res.statusCode}`))
        return
      }
      const total = Number(res.headers['content-length'] || 0)
      let received = 0
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        onProgress?.(received, total)
      })
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    })
    req.on('error', (err) => {
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
