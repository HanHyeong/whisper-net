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
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const url = `http://${ip}:${port}/whisper/share/${encodeURIComponent(fileName)}`
    const req = http.get(url, { timeout: 30000 }, (res) => {
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
