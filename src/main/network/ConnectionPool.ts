import { EventEmitter } from 'events'
import { TcpServer } from './TcpServer'
import { TcpClient } from './TcpClient'
import { PeerInfo, ProtocolMessage } from './protocol'

export class ConnectionPool extends EventEmitter {
  private server: TcpServer
  private client: TcpClient

  constructor(
    tcpPort: number,
    private getPeer: (peerId: string) => PeerInfo | undefined
  ) {
    super()
    this.server = new TcpServer(tcpPort)
    this.client = new TcpClient()
  }

  start() {
    this.server.start()
    this.server.on('message', (msg, socket) => this.emit('message', msg, socket))
    this.server.on('peer:disconnect', (peerId) => this.emit('peer:disconnect', peerId))

    this.client.on('message', (msg) => this.emit('message', msg))
    this.client.on('connected', (peerId, socket) => this.emit('connected', peerId, socket))
    this.client.on('disconnected', (peerId) => this.emit('disconnected', peerId))
  }

  registerSocket(peerId: string, socket: any) {
    this.server.registerSocket(peerId, socket)
  }

  connect(peerId: string, ip: string, port: number): Promise<boolean> {
    return this.client.connect(peerId, ip, port)
  }

  disconnect(peerId: string) {
    this.client.disconnect(peerId)
  }

  send(peerId: string, msg: ProtocolMessage) {
    const ok = this.server.send(peerId, msg) || this.client.send(peerId, msg)
    if (!ok) {
      const peer = this.getPeer(peerId)
      if (peer) {
        this.client.connect(peerId, peer.ip, peer.tcpPort).then((connected) => {
          if (connected) {
            const sent = this.server.send(peerId, msg) || this.client.send(peerId, msg)
            if (!sent) {
              console.warn(`[whisper-net] send failed: ${msg.type} -> ${peerId}`)
            }
          } else {
            console.warn(`[whisper-net] connect failed: ${msg.type} -> ${peerId}`)
          }
        })
      } else {
        console.warn(`[whisper-net] send: unknown peer ${peerId} (${msg.type})`)
      }
    }
  }

  sendViaClient(peerId: string, msg: ProtocolMessage): boolean {
    return this.client.send(peerId, msg)
  }

  stop() {
    this.server.stop()
    this.client.disconnectAll()
  }
}
