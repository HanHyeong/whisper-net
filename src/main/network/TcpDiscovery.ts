import http from 'http'
import { EventEmitter } from 'events'
import { PeerInfo } from './protocol'
import os from 'os'
import fs from 'fs'
import path from 'path'

const PORT_RANGE = [8080, 8081, 8082, 8083]

export class TcpDiscovery extends EventEmitter {
  private server: http.Server | null = null
  private port = 0
  private myInfo: { peerId: string; nickname: string; tcpPort: number; rooms: PeerInfo['rooms'] }
  private sharedPath: string | null = null

  constructor(peerId: string, nickname: string, tcpPort: number) {
    super()
    this.myInfo = { peerId, nickname, tcpPort, rooms: [] }
  }

  async start() {
    for (const p of PORT_RANGE) {
      try {
        await this.tryListen(p)
        this.port = p
        break
      } catch {
        continue
      }
    }
    if (this.port === 0) {
      this.emit('error', new Error('No available discovery port'))
      return
    }
  }

  private tryListen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const pathname = this.getPathname(req)
        if (pathname === '/whisper/peers' && req.method === 'GET') {
          const body = JSON.stringify({
            self: {
              peerId: this.myInfo.peerId,
              nickname: this.myInfo.nickname,
              ip: this.getLocalIp(),
              tcpPort: this.myInfo.tcpPort,
              discoveryPort: this.port,
              rooms: this.myInfo.rooms,
            },
            knownPeers: [],
          })
          res.writeHead(200)
          res.end(body)
        } else if (pathname === '/whisper/heartbeat' && req.method === 'POST') {
          // Accept heartbeat but do nothing (mDNS handles peer discovery)
          res.writeHead(200)
          res.end('{}')
        } else if (pathname === '/whisper/share' && req.method === 'GET') {
          this.handleShareList(req, res)
        } else if (pathname.startsWith('/whisper/share/') && req.method === 'GET') {
          this.handleShareDownload(req, res)
        } else if (pathname === '/whisper/room-attachment' && req.method === 'GET') {
          this.handleRoomAttachmentDownload(req, res)
        } else {
          res.writeHead(404)
          res.end()
        }
      })
      s.listen(port, () => resolve())
      s.on('error', (e) => reject(e))
      this.server = s
    })
  }

  private getPathname(req: http.IncomingMessage): string {
    try {
      return new URL(req.url!, `http://${req.headers.host}`).pathname
    } catch {
      return req.url || ''
    }
  }

  getLocalIp(): string {
    const ifaces = os.networkInterfaces()
    const ips: string[] = []
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address)
        }
      }
    }
    if (ips.length === 0) return '127.0.0.1'
    const privateIp = ips.find((ip) =>
      ip.startsWith('10.') ||
      ip.startsWith('172.1') || ip.startsWith('172.2') || ip.startsWith('172.3') ||
      ip.startsWith('192.168.')
    )
    return privateIp || ips[0]
  }

  setNickname(nickname: string) {
    this.myInfo.nickname = nickname
  }

  setSharedPath(p: string | null) {
    this.sharedPath = p
  }

  getSharedPath(): string | null {
    return this.sharedPath
  }

  setRooms(rooms: PeerInfo['rooms']) {
    this.myInfo.rooms = rooms
  }

  getPort(): number {
    return this.port
  }

  private handleShareList(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.sharedPath || !fs.existsSync(this.sharedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No shared folder' }))
      return
    }
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`)
      const relativePath = decodeURIComponent(url.searchParams.get('path') || '')
      const targetPath = path.join(this.sharedPath, relativePath)

      const resolvedShared = path.resolve(this.sharedPath)
      const resolvedTarget = path.resolve(targetPath)
      if (!resolvedTarget.startsWith(resolvedShared)) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Access denied' }))
        return
      }

      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }

      const entries = fs.readdirSync(targetPath, { withFileTypes: true })
      const items = entries
        .filter((e) => e.name !== '_roomsFiles')
        .map((e) => {
          const stat = fs.statSync(path.join(targetPath, e.name))
          return {
            name: e.name,
            size: stat.size,
            modified: stat.mtime.getTime(),
            isDirectory: e.isDirectory(),
          }
        })
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name)
        })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sharedPath: this.sharedPath, currentPath: relativePath, items }))
    } catch {
      res.writeHead(500)
      res.end()
    }
  }

  private handleShareDownload(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.sharedPath) {
      res.writeHead(404)
      res.end()
      return
    }
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const relativePath = decodeURIComponent(url.pathname.replace('/whisper/share/', ''))
    const filePath = this.resolveAttachmentFile(relativePath)
    if (!filePath) {
      res.writeHead(404)
      res.end()
      return
    }
    this.streamAttachmentFile(res, filePath, path.basename(filePath))
  }

  private handleRoomAttachmentDownload(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.sharedPath) {
      res.writeHead(404)
      res.end()
      return
    }
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const roomId = url.searchParams.get('roomId') || ''
    const messageId = url.searchParams.get('messageId') || ''
    const fileName = url.searchParams.get('fileName') || ''
    if (!roomId || !messageId) {
      res.writeHead(400)
      res.end()
      return
    }
    const dirPath = path.join(this.sharedPath, '_roomsFiles', roomId, messageId)
    const filePath = this.resolveAttachmentFileInDir(dirPath, fileName ? path.basename(fileName) : undefined)
    if (!filePath) {
      res.writeHead(404)
      res.end()
      return
    }
    this.streamAttachmentFile(res, filePath, path.basename(filePath))
  }

  private resolveAttachmentFile(relativePath: string): string | null {
    if (!this.sharedPath) return null
    const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!normalized) return null

    const resolvedShared = path.resolve(this.sharedPath)
    const directPath = path.resolve(path.join(this.sharedPath, normalized))
    if (this.isPathInside(directPath, resolvedShared) && fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return directPath
    }

    const parts = normalized.split('/')
    if (parts.length >= 3 && parts[0] === '_roomsFiles') {
      const dirPath = path.resolve(path.join(this.sharedPath, ...parts.slice(0, -1)))
      return this.resolveAttachmentFileInDir(dirPath, parts[parts.length - 1])
    }
    if (parts.length === 3 && parts[0] === '_roomsFiles') {
      const dirPath = path.resolve(path.join(this.sharedPath, ...parts))
      return this.resolveAttachmentFileInDir(dirPath)
    }
    return null
  }

  private resolveAttachmentFileInDir(dirPath: string, preferredName?: string): string | null {
    if (!this.sharedPath) return null
    const resolvedShared = path.resolve(this.sharedPath)
    if (!this.isPathInside(dirPath, resolvedShared) || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return null
    }
    if (preferredName) {
      const preferredPath = path.join(dirPath, preferredName)
      if (fs.existsSync(preferredPath) && fs.statSync(preferredPath).isFile()) {
        return preferredPath
      }
    }
    const files = fs
      .readdirSync(dirPath)
      .filter((name) => fs.statSync(path.join(dirPath, name)).isFile())
    if (files.length === 1) {
      return path.join(dirPath, files[0])
    }
    if (preferredName && files.includes(preferredName)) {
      return path.join(dirPath, preferredName)
    }
    return null
  }

  private isPathInside(targetPath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private streamAttachmentFile(res: http.ServerResponse, filePath: string, downloadName: string) {
    const stat = fs.statSync(filePath)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadName)}"`,
    })
    fs.createReadStream(filePath).pipe(res)
  }

  stop() {
    this.server?.close()
  }
}
