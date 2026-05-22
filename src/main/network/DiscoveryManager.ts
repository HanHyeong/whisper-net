import { EventEmitter } from 'events'
import { TcpDiscovery, UpdateServeBridge } from './TcpDiscovery'
import { MdnsDiscovery } from './MdnsDiscovery'
import { PeerRegistry } from './PeerRegistry'
import { PeerInfo, RoomInfo } from './protocol'

export class DiscoveryManager extends EventEmitter {
  private tcp: TcpDiscovery
  private mdns: MdnsDiscovery | null = null
  private mdnsActive = false

  constructor(
    private peerId: string,
    private nickname: string,
    private tcpPort: number,
    private registry: PeerRegistry
  ) {
    super()
    this.tcp = new TcpDiscovery(peerId, nickname, tcpPort)
  }

  async start() {
    await this.tcp.start()
    this.activateMdns()
  }

  private activateMdns() {
    if (this.mdnsActive) return
    this.mdnsActive = true
    this.mdns = new MdnsDiscovery(
      this.peerId,
      this.nickname,
      this.tcpPort,
      this.tcp.getPort(),
      this.tcp.getLocalIp()
    )
    this.mdns.on('peer:found', (p) => this.handlePeer(p))
    this.mdns.on('peer:left', (pid) => {
      if (this.registry.remove(pid)) {
        this.emit('peer:left', pid)
      }
    })
    this.mdns.start()
  }

  private handlePeer(p: PeerInfo) {
    const isNew = !this.registry.has(p.peerId)
    const info = this.registry.upsert(
      {
        peerId: p.peerId,
        nickname: p.nickname,
        ip: p.ip,
        tcpPort: p.tcpPort,
        discoveryPort: p.discoveryPort || 8080,
        lastSeen: Date.now(),
        rooms: [],
      },
      'mdns'
    )
    if (isNew) {
      this.emit('peer:joined', info)
    } else {
      this.emit('peer:updated', info)
    }
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

  /** HTTP discovery 스냅샷만 갱신 (mDNS TXT에는 rooms 미포함) */
  setLocalRooms(rooms: RoomInfo[]) {
    this.tcp.setRooms(rooms)
  }

  getLocalIp(): string {
    return this.tcp.getLocalIp()
  }

  getDiscoveryPort(): number {
    return this.tcp.getPort()
  }

  setUpdateBridge(bridge: UpdateServeBridge | null) {
    this.tcp.setUpdateBridge(bridge)
  }

  stop() {
    this.tcp.stop()
    this.mdns?.stop()
  }
}
