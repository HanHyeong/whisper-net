import { EventEmitter } from 'events'
import { DiscoveryManager } from './DiscoveryManager'
import { PeerRegistry } from './PeerRegistry'
import { PeerSyncService } from './PeerSyncService'
import { ConnectionPool } from './ConnectionPool'
import { RoomService } from './RoomService'
import { MessageService } from './MessageService'
import { PeerInfo } from './protocol'
import { LocalPeer, Room } from './types'

export type { LocalPeer, Room, ChatMessage, AttachmentInfo } from './types'

export class NetworkManager extends EventEmitter {
  private discovery: DiscoveryManager
  private peerRegistry: PeerRegistry
  private connectionPool: ConnectionPool
  private roomService: RoomService
  private peerSync: PeerSyncService
  private messageService: MessageService

  constructor(private local: LocalPeer) {
    super()
    this.peerRegistry = new PeerRegistry()
    this.peerRegistry.on('changed', (peers) => this.emit('peers', peers))

    this.discovery = new DiscoveryManager(
      local.peerId,
      local.nickname,
      local.tcpPort,
      this.peerRegistry
    )

    this.connectionPool = new ConnectionPool(local.tcpPort, (id) => this.peerRegistry.get(id))

    this.roomService = new RoomService({
      local: this.local,
      getPeers: () => this.peerRegistry.list(),
      sendDirect: (id, msg) => this.connectionPool.send(id, msg),
      broadcastToRoom: (roomId, msg, exclude) =>
        this.messageService.broadcastToRoom(roomId, msg, exclude),
      onLocalRoomsChanged: () => {
        this.peerSync.updateLocalRooms()
        this.emit('rooms', this.roomService.getAll())
      },
      onJoinRejected: (info) => this.emit('join:rejected', info),
      onRoomJoined: (roomId) => this.emit('room:joined', roomId),
    })

    this.peerSync = new PeerSyncService({
      registry: this.peerRegistry,
      discovery: this.discovery,
      local: this.local,
      getLocalRoomList: () => this.roomService.getLocalRoomList(),
      getDiscoveryPort: () => this.discovery.getDiscoveryPort(),
      sendDirect: (id, msg) => this.connectionPool.send(id, msg),
    })

    this.messageService = new MessageService({
      local: this.local,
      roomService: this.roomService,
      peerRegistry: this.peerRegistry,
      peerSync: this.peerSync,
      connectionPool: this.connectionPool,
      sendDirect: (id, msg) => this.connectionPool.send(id, msg),
      onChatMessage: (chat) => this.emit('message', chat),
      onFileOffer: (offer) => this.emit('file:offer', offer),
      onFileChunk: (chunk) => this.emit('file:chunk', chunk),
    })
  }

  async start() {
    this.connectionPool.start()
    this.connectionPool.on('message', (msg, socket) => this.messageService.handle(msg, socket))
    this.connectionPool.on('peer:disconnect', (peerId) => this.handlePeerDisconnect(peerId))
    this.connectionPool.on('disconnected', (peerId) => this.handlePeerDisconnect(peerId))
    this.connectionPool.on('connected', (peerId, socket) => {
      this.connectionPool.registerSocket(peerId, socket)
      this.connectionPool.sendViaClient(peerId, {
        type: 'discover_ack',
        peerId: this.local.peerId,
        nickname: this.local.nickname,
        timestamp: Date.now(),
        payload: this.peerSync.getDiscoverAckPayload(),
      })
      this.peerSync.advertiseRoomsToPeer(peerId)
    })

    this.discovery.start()
    this.discovery.on('peer:joined', (info) => {
      this.connectionPool.connect(info.peerId, info.ip, info.tcpPort)
      this.peerSync.onPeerJoined(info.peerId)
    })
    this.discovery.on('peer:left', (peerId) => {
      this.connectionPool.disconnect(peerId)
      this.roomService.removeMemberFromAllRooms(peerId)
      this.peerSync.updateLocalRooms()
      this.emit('rooms', this.roomService.getAll())
    })
  }

  createRoom(name: string, type: 'public' | 'private', password?: string): Room | null {
    return this.roomService.createRoom(name, type, password)
  }

  joinRoom(roomId: string, password?: string, name?: string, type?: 'public' | 'private') {
    this.roomService.joinRoom(roomId, password, name, type)
  }

  sendFileAttachment(
    roomId: string,
    fileName: string,
    fileSize: number,
    checksum: string,
    messageId: string,
    localPath: string,
    dataUrl?: string
  ) {
    this.messageService.sendFileAttachment(
      roomId,
      fileName,
      fileSize,
      checksum,
      messageId,
      localPath,
      dataUrl
    )
  }

  sendText(roomId: string, content: string) {
    this.messageService.sendText(roomId, content)
  }

  offerFile(peerId: string, fileName: string, fileSize: number, mimeType: string) {
    return this.messageService.offerFile(peerId, fileName, fileSize, mimeType)
  }

  sendFileChunk(peerId: string, transferId: string, chunk: Buffer, index: number, total: number) {
    this.messageService.sendFileChunk(peerId, transferId, chunk, index, total)
  }

  updateNickname(nickname: string) {
    this.local.nickname = nickname
    this.discovery.setNickname(nickname)
    for (const peer of this.peerRegistry.list()) {
      this.connectionPool.send(peer.peerId, {
        type: 'nickname_changed',
        peerId: this.local.peerId,
        nickname: this.local.nickname,
        timestamp: Date.now(),
      })
    }
  }

  async refreshPeers(): Promise<number> {
    return this.peerSync.refreshPeers()
  }

  async refreshPeer(peerId: string): Promise<boolean> {
    const updated = await this.peerSync.refreshPeer(peerId)
    return updated !== null
  }

  schedulePeerRefresh(delayMs = 500): void {
    this.peerSync.scheduleRefreshAll(delayMs)
  }

  getSharedPath(): string | null {
    return this.discovery.getSharedPath()
  }

  setSharedPath(p: string | null) {
    this.discovery.setSharedPath(p)
  }

  connectPeer(ip: string, port: number) {
    const peerId = `manual-${ip}-${port}`
    this.connectionPool.connect(peerId, ip, port).then((connected) => {
      if (connected) {
        this.connectionPool.sendViaClient(peerId, {
          type: 'discover_ack',
          peerId: this.local.peerId,
          nickname: this.local.nickname,
          timestamp: Date.now(),
          payload: this.peerSync.getDiscoverAckPayload(),
        })
      }
    })
  }

  getPeers(): PeerInfo[] {
    return this.peerRegistry.list()
  }

  getRooms(): Room[] {
    return this.roomService.getAll()
  }

  getLocalIp(): string {
    return this.discovery.getLocalIp()
  }

  getTcpPort(): number {
    return this.local.tcpPort
  }

  getDiscoveryPort(): number {
    return this.discovery.getDiscoveryPort()
  }

  private handlePeerDisconnect(peerId: string) {
    if (!this.peerRegistry.has(peerId)) return
    this.peerRegistry.remove(peerId)
    this.connectionPool.disconnect(peerId)
    this.roomService.removeMemberFromAllRooms(peerId)
    this.peerSync.updateLocalRooms()
    this.emit('rooms', this.roomService.getAll())
  }

  stop() {
    this.discovery.stop()
    this.connectionPool.stop()
  }
}
