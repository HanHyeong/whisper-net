import net from 'net'
import { EventEmitter } from 'events'
import { ProtocolMessage, decodeMessages, encodeMessage } from './protocol'

export class TcpClient extends EventEmitter {
  private sockets = new Map<string, net.Socket>() // peerId -> socket (outgoing)
  private buffers = new Map<string, Buffer>()
  private connecting = new Set<string>()

  connect(peerId: string, ip: string, port: number): Promise<boolean> {
    if (this.sockets.has(peerId) || this.connecting.has(peerId)) {
      return Promise.resolve(this.sockets.has(peerId))
    }
    this.connecting.add(peerId)

    return new Promise((resolve) => {
      const socket = new net.Socket()
      const socketId = `${ip}:${port}`
      this.buffers.set(socketId, Buffer.alloc(0))

      socket.connect(port, ip, () => {
        this.connecting.delete(peerId)
        this.sockets.set(peerId, socket)
        this.emit('connected', peerId, socket)
        resolve(true)
      })

      socket.on('data', (data) => {
        const buf = this.buffers.get(socketId)!
        const combined = Buffer.concat([buf, data])
        const { messages, remainder } = decodeMessages(combined)
        this.buffers.set(socketId, remainder)
        for (const msg of messages) {
          this.emit('message', msg, peerId)
        }
      })

      socket.on('close', () => {
        this.buffers.delete(socketId)
        this.sockets.delete(peerId)
        this.emit('disconnected', peerId)
      })

      socket.on('error', () => {
        this.connecting.delete(peerId)
        resolve(false)
      })
    })
  }

  send(peerId: string, msg: ProtocolMessage): boolean {
    const socket = this.sockets.get(peerId)
    if (!socket || socket.destroyed) return false
    socket.write(encodeMessage(msg))
    return true
  }

  isConnected(peerId: string): boolean {
    const s = this.sockets.get(peerId)
    return !!s && !s.destroyed
  }

  disconnect(peerId: string) {
    this.sockets.get(peerId)?.destroy()
    this.sockets.delete(peerId)
  }

  disconnectAll() {
    for (const [id, socket] of this.sockets) {
      socket.destroy()
    }
    this.sockets.clear()
    this.buffers.clear()
    this.connecting.clear()
  }
}
