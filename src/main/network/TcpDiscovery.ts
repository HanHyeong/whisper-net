import http from 'http'
import { EventEmitter } from 'events'
import { PeerInfo } from './protocol'
import os from 'os'
import fs from 'fs'
import path from 'path'

const DISCOVERY_PORT = 8080
const PORT_RANGE = [8080, 8081, 8082, 8083]
const SCAN_BATCH = 10
const SCAN_TIMEOUT = 400

interface KnownPeer {
  peerId: string
  nickname: string
  ip: string
  tcpPort: number
  discoveryPort: number
  rooms: PeerInfo['rooms']
}

export class TcpDiscovery extends EventEmitter {
  private server: http.Server | null = null
  private port = 0
  private knownPeers = new Map<string, KnownPeer>()
  private scanTimer: NodeJS.Timeout | null = null
  private cleanupTimer: NodeJS.Timeout | null = null
  private lastSeen = new Map<string, number>()
  private myInfo: { peerId: string; nickname: string; tcpPort: number; rooms: PeerInfo['rooms'] }
  private sharedPath: string | null = null
  private readonly PEER_TIMEOUT = 15000

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

    // initial scan + gossip loop
    this.scanOnce()
    this.scanTimer = setInterval(() => this.scanOnce(), 8000)
    this.startCleanup()
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
            knownPeers: Array.from(this.knownPeers.values()),
          })
          res.writeHead(200)
          res.end(body)
        } else if (pathname === '/whisper/heartbeat' && req.method === 'POST') {
          let data = ''
          req.on('data', (c) => (data += c))
          req.on('end', () => {
            try {
              const body = JSON.parse(data)
              if (body.peerId && body.peerId !== this.myInfo.peerId) {
                this.addPeer(body)
              }
            } catch {}
            res.writeHead(200)
            res.end('{}')
          })
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

  private async scanOnce() {
    const myIps = this.getLocalIps()
    if (myIps.length === 0) return

    // Collect targets from all subnets
    const targetSet = new Set<string>()
    for (const myIp of myIps) {
      const prefix = myIp.split('.').slice(0, 3).join('.')
      for (let i = 1; i <= 254; i++) {
        const ip = `${prefix}.${i}`
        if (ip === myIp) continue
        targetSet.add(ip)
      }
    }

    const targets = Array.from(targetSet)

    // shuffle + batch
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]]
    }

    for (let i = 0; i < targets.length; i += SCAN_BATCH) {
      const batch = targets.slice(i, i + SCAN_BATCH)
      await Promise.all(batch.map((ip) => this.probePeer(ip)))
      await new Promise((r) => setTimeout(r, 80)) // gentle pacing
    }
  }

  private async probePeer(ip: string): Promise<void> {
    for (const port of PORT_RANGE) {
      try {
        const data = await this.httpGet(`http://${ip}:${port}/whisper/peers`)
        const json = JSON.parse(data)
        if (json.self && json.self.peerId !== this.myInfo.peerId) {
          this.addPeer(json.self)
          this.emit('peer:found', json.self)
        }
        // gossip: add peers they know
        if (json.knownPeers) {
          for (const p of json.knownPeers) {
            if (p.peerId !== this.myInfo.peerId) {
              this.addPeer(p)
              this.emit('peer:found', p)
            }
          }
        }
        // send our heartbeat back
        this.httpPost(`http://${ip}:${port}/whisper/heartbeat`, {
          peerId: this.myInfo.peerId,
          nickname: this.myInfo.nickname,
          ip: this.getLocalIp(),
          tcpPort: this.myInfo.tcpPort,
          rooms: this.myInfo.rooms,
        }).catch(() => {})
        return
      } catch {
        continue
      }
    }
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: SCAN_TIMEOUT }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    })
  }

  private async httpPost(url: string, body: object): Promise<string> {
    return new Promise((resolve, reject) => {
      const u = new URL(url)
      const data = JSON.stringify(body)
      const req = http.request(
        { hostname: u.hostname, port: Number(u.port), path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: SCAN_TIMEOUT },
        (res) => {
          let d = ''
          res.on('data', (c) => (d += c))
          res.on('end', () => resolve(d))
        }
      )
      req.on('error', reject)
      req.write(data)
      req.end()
    })
  }

  private addPeer(p: KnownPeer) {
    this.knownPeers.set(p.peerId, p)
    this.lastSeen.set(p.peerId, Date.now())
  }

  private startCleanup() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, last] of this.lastSeen) {
        if (now - last > this.PEER_TIMEOUT) {
          this.knownPeers.delete(id)
          this.lastSeen.delete(id)
          this.emit('peer:left', id)
        }
      }
    }, 5000)
  }

  private getLocalIps(): string[] {
    const ips: string[] = []
    const ifaces = os.networkInterfaces()
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address)
        }
      }
    }
    return ips.length > 0 ? ips : ['127.0.0.1']
  }

  private getLocalIp(): string {
    const ips = this.getLocalIps()
    // Prefer 10.x / 172.16-31.x / 192.168.x private ranges over others
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

  getPeers(): KnownPeer[] {
    return Array.from(this.knownPeers.values())
  }

  private handleShareList(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.sharedPath || !fs.existsSync(this.sharedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'No shared folder' }))
      return
    }
    try {
      // Parse ?path= query for subfolder navigation
      const url = new URL(req.url!, `http://${req.headers.host}`)
      const relativePath = decodeURIComponent(url.searchParams.get('path') || '')
      const targetPath = path.join(this.sharedPath, relativePath)

      // Path traversal guard
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
    const fileName = decodeURIComponent(req.url!.replace('/whisper/share/', ''))
    const filePath = path.join(this.sharedPath, fileName)
    // Security: prevent directory traversal
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
    if (this.scanTimer) clearInterval(this.scanTimer)
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.server?.close()
  }
}
