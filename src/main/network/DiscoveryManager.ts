import { EventEmitter } from 'events'
import { TcpDiscovery } from './TcpDiscovery'
import { MdnsDiscovery } from './MdnsDiscovery'
import { PeerInfo } from './protocol'

const FALLBACK_DELAY_MS = 5000

export class DiscoveryManager extends EventEmitter {
  private tcp: TcpDiscovery
  private mdns: MdnsDiscovery | null = null
  private peers = new Map<string, PeerInfo>()
  private fallbackTimer: NodeJS.Timeout | null = null
  private mdnsActive = false

  constructor(
    private peerId: string,
    private nickname: string,
    private tcpPort: number,
    private rooms: PeerInfo['rooms'] = []
  ) {
    super()
    this.tcp = new TcpDiscovery(peerId, nickname, tcpPort)
  }

  async start() {
    this.tcp.on('peer:found', (p) => this.handlePeer(p))
    this.tcp.on('peer:left', (peerId) => {
      if (this.peers.has(peerId)) {
        this.peers.delete(peerId)
        this.emit('peer:left', peerId)
        this.emitPeers()
      }
    })
    this.tcp.on('error', () => {
      this.activateMdns()
    })

    await this.tcp.start()

    // if no peer found within 5s, activate mDNS fallback
    this.fallbackTimer = setTimeout(() => {
      if (this.peers.size === 0) {
        this.activateMdns()
      }
    }, FALLBACK_DELAY_MS)
  }

  private activateMdns() {
    if (this.mdnsActive) return
    this.mdnsActive = true
    this.mdns = new MdnsDiscovery(this.peerId, this.nickname, this.tcpPort, this.rooms, this.tcp.getPort())
    this.mdns.on('peer:found', (p) => this.handlePeer(p))
    this.mdns.on('peer:left', (pid) => {
      this.peers.delete(pid)
      this.emit('peer:left', pid)
      this.emitPeers()
    })
    this.mdns.start()
  }

  private handlePeer(p: any) {
    const info: PeerInfo = {
      peerId: p.peerId,
      nickname: p.nickname,
      ip: p.ip,
      tcpPort: p.tcpPort,
      discoveryPort: p.discoveryPort || 8080,
      lastSeen: Date.now(),
      rooms: p.rooms || [],
    }
    const existing = this.peers.get(info.peerId)
    this.peers.set(info.peerId, info)
    if (!existing) {
      this.emit('peer:joined', info)
    } else {
      this.emit('peer:updated', info)
    }
    this.emitPeers()
  }

  private emitPeers() {
    this.emit('peers', Array.from(this.peers.values()))
  }

  setNickname(nickname: string) {
    this.nickname = nickname
    this.tcp.setNickname?.(nickname)
    this.mdns?.setNickname?.(nickname)
  }

  getSharedPath(): string | null {
    return this.tcp.getSharedPath()
  }

  setSharedPath(p: string | null) {
    this.tcp.setSharedPath(p)
  }

  setRooms(rooms: PeerInfo['rooms']) {
    this.rooms = rooms
    this.tcp.setRooms(rooms)
    this.mdns?.setRooms(rooms)
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  async refreshPeers(): Promise<number> {
    let updatedCount = 0
    for (const [peerId, peer] of this.peers) {
      if (!peer.discoveryPort) continue
      try {
        const data = await this.httpGet(
          `http://${peer.ip}:${peer.discoveryPort}/whisper/peers`,
          3000
        )
        const json = JSON.parse(data)
        if (json.self && json.self.peerId === peerId) {
          const updated: PeerInfo = {
            ...peer,
            nickname: json.self.nickname || peer.nickname,
            rooms: json.self.rooms || peer.rooms,
            lastSeen: Date.now(),
          }
          this.peers.set(peerId, updated)
          this.emit('peer:updated', updated)
          updatedCount++
        }
      } catch {
        // Peer may be unreachable; skip silently
      }
    }
    if (updatedCount > 0) {
      this.emitPeers()
    }
    return updatedCount
  }

  private httpGet(url: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = require('http').get(url, { timeout }, (res: any) => {
        let data = ''
        res.on('data', (c: any) => (data += c))
        res.on('end', () => resolve(data))
      })
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('timeout'))
      })
    })
  }

  stop() {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
    this.tcp.stop()
    this.mdns?.stop()
  }
}
