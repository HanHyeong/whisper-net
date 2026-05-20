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
    const fileName = decodeURIComponent(url.pathname.replace('/whisper/share/', ''))
    const filePath = path.join(this.sharedPath, fileName)
    if (!filePath.startsWith(this.sharedPath)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    const stat = fs.statSync(filePath)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    })
    fs.createReadStream(filePath).pipe(res)
  }

  stop() {
    this.server?.close()
  }
}
