import { EventEmitter } from 'events'
import { PeerInfo, RoomInfo } from './protocol'

export type PeerInfoSource = 'mdns' | 'http' | 'tcp' | 'manual'

export class PeerRegistry extends EventEmitter {
  private peers = new Map<string, PeerInfo>()
  private pendingPeerRooms = new Map<string, RoomInfo[]>()

  get(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId)
  }

  list(): PeerInfo[] {
    return Array.from(this.peers.values())
  }

  has(peerId: string): boolean {
    return this.peers.has(peerId)
  }

  remove(peerId: string): boolean {
    const removed = this.peers.delete(peerId)
    this.pendingPeerRooms.delete(peerId)
    if (removed) this.emitChanged()
    return removed
  }

  upsert(incoming: PeerInfo, source: PeerInfoSource = 'mdns'): PeerInfo {
    const existing = this.peers.get(incoming.peerId)
    let rooms = incoming.rooms ?? []

    if (source === 'mdns' && rooms.length === 0 && existing?.rooms?.length) {
      rooms = existing.rooms
    } else if (source === 'http') {
      rooms = incoming.rooms ?? existing?.rooms ?? []
    } else if (source === 'tcp' && incoming.rooms?.length) {
      rooms = incoming.rooms
    } else if (!rooms.length && existing?.rooms?.length) {
      rooms = existing.rooms
    }

    const merged: PeerInfo = {
      peerId: incoming.peerId,
      nickname: incoming.nickname || existing?.nickname || 'Unknown',
      ip: incoming.ip || existing?.ip || '',
      tcpPort: incoming.tcpPort || existing?.tcpPort || 41235,
      discoveryPort: incoming.discoveryPort || existing?.discoveryPort || 8080,
      lastSeen: incoming.lastSeen ?? Date.now(),
      rooms,
    }

    this.peers.set(incoming.peerId, merged)
    this.emitChanged()
    return merged
  }

  setNickname(peerId: string, nickname: string): void {
    const peer = this.peers.get(peerId)
    if (!peer) return
    peer.nickname = nickname
    peer.lastSeen = Date.now()
    this.emitChanged()
  }

  setRooms(peerId: string, rooms: RoomInfo[]): void {
    const peer = this.peers.get(peerId)
    if (!peer) return
    peer.rooms = rooms
    peer.lastSeen = Date.now()
    this.emitChanged()
  }

  setPendingRooms(peerId: string, rooms: RoomInfo[]): void {
    this.pendingPeerRooms.set(peerId, rooms)
  }

  applyPendingRooms(peerId: string): boolean {
    const pending = this.pendingPeerRooms.get(peerId)
    if (!pending) return false
    const peer = this.peers.get(peerId)
    if (!peer) return false
    peer.rooms = pending
    this.pendingPeerRooms.delete(peerId)
    this.emitChanged()
    return true
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }
}
