import http from 'http'
import { PeerRegistry } from './PeerRegistry'
import { DiscoveryManager } from './DiscoveryManager'
import { PeerInfo, ProtocolMessage, RoomInfo } from './protocol'

type SendDirectFn = (peerId: string, msg: ProtocolMessage) => void

export interface LocalPeerInfo {
  peerId: string
  nickname: string
  tcpPort: number
}

export interface PeerSyncServiceDeps {
  registry: PeerRegistry
  discovery: DiscoveryManager
  local: LocalPeerInfo
  getLocalRoomList: () => RoomInfo[]
  getDiscoveryPort: () => number
  sendDirect: SendDirectFn
}

export class PeerSyncService {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private readonly inFlight = new Set<string>()

  constructor(private deps: PeerSyncServiceDeps) {}

  updateLocalRooms(): void {
    const rooms = this.deps.getLocalRoomList()
    this.deps.discovery.setLocalRooms(rooms)
    this.advertiseRooms()
  }

  getDiscoverAckPayload() {
    return {
      tcpPort: this.deps.local.tcpPort,
      discoveryPort: this.deps.getDiscoveryPort(),
      rooms: this.deps.getLocalRoomList(),
    }
  }

  handleRoomAdvertised(peerId: string, rooms: RoomInfo[]): void {
    const peer = this.deps.registry.get(peerId)
    if (peer) {
      this.deps.registry.setRooms(peerId, rooms)
    } else {
      this.deps.registry.setPendingRooms(peerId, rooms)
    }
  }

  handleDiscoverAck(peer: PeerInfo): PeerInfo {
    const updated = this.deps.registry.upsert(peer, 'tcp')
    this.deps.registry.applyPendingRooms(peer.peerId)
    return updated
  }

  onPeerJoined(peerId: string): void {
    void this.syncPeerRooms(peerId)
    this.scheduleRefreshAll(500)
  }

  onDiscoverAck(peerId: string): void {
    this.advertiseRoomsToPeer(peerId)
    void this.syncPeerRooms(peerId)
  }

  advertiseRooms(): void {
    for (const peer of this.deps.registry.list()) {
      if (peer.peerId === this.deps.local.peerId) continue
      this.advertiseRoomsToPeer(peer.peerId)
    }
  }

  advertiseRoomsToPeer(peerId: string): void {
    if (peerId === this.deps.local.peerId) return
    const msg: ProtocolMessage = {
      type: 'room_advertised',
      peerId: this.deps.local.peerId,
      nickname: this.deps.local.nickname,
      timestamp: Date.now(),
      payload: { rooms: this.deps.getLocalRoomList() },
    }
    this.deps.sendDirect(peerId, msg)
  }

  scheduleRefreshAll(delayMs = 500): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshPeers()
    }, delayMs)
  }

  async refreshPeers(): Promise<number> {
    let updatedCount = 0
    for (const peer of this.deps.registry.list()) {
      const updated = await this.refreshPeer(peer.peerId)
      if (updated) updatedCount++
    }
    return updatedCount
  }

  async refreshPeer(peerId: string): Promise<PeerInfo | null> {
    if (this.inFlight.has(peerId)) return this.deps.registry.get(peerId) ?? null
    const peer = this.deps.registry.get(peerId)
    if (!peer?.discoveryPort) return null

    this.inFlight.add(peerId)
    try {
      const data = await this.httpGet(
        `http://${peer.ip}:${peer.discoveryPort}/whisper/peers`,
        3000
      )
      const json = JSON.parse(data)
      if (json.self && json.self.peerId === peerId) {
        const updated = this.deps.registry.upsert(
          {
            ...peer,
            nickname: json.self.nickname || peer.nickname,
            rooms: json.self.rooms || [],
            lastSeen: Date.now(),
          },
          'http'
        )
        this.deps.registry.applyPendingRooms(peerId)
        return updated
      }
    } catch {
      // Peer may be unreachable; skip silently
    } finally {
      this.inFlight.delete(peerId)
    }
    return null
  }

  async syncPeerRooms(peerId: string): Promise<void> {
    const updated = await this.refreshPeer(peerId)
    if (updated) return
    setTimeout(() => {
      void this.refreshPeer(peerId)
    }, 500)
  }

  private httpGet(url: string, timeout: number): Promise<string> {
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
}
