import net from 'net'
import { EventEmitter } from 'events'
import { ProtocolMessage, decodeMessages, encodeMessage } from './protocol'

export class TcpServer extends EventEmitter {
  private server: net.Server | null = null
  private sockets = new Map<string, net.Socket>() // peerId -> socket (incoming)
  private buffers = new Map<string, Buffer>() // socket id -> accumulated buffer
  private allSockets = new Set<net.Socket>()

  constructor(private port: number) {
    super()
  }

  start() {
    this.server = net.createServer((socket) => {
      const socketId = `${socket.remoteAddress}:${socket.remotePort}`
      this.allSockets.add(socket)
      this.buffers.set(socketId, Buffer.alloc(0))

      socket.on('data', (data) => {
        const buf = this.buffers.get(socketId)
        if (!buf) return
        const combined = Buffer.concat([buf, data])
        const { messages, remainder } = decodeMessages(combined)
        this.buffers.set(socketId, remainder)
        for (const msg of messages) {
          this.emit('message', msg, socket)
        }
      })

      socket.on('close', () => {
        socket.removeAllListeners()
        this.allSockets.delete(socket)
        this.buffers.delete(socketId)
        for (const [pid, s] of this.sockets) {
          if (s === socket) {
            this.sockets.delete(pid)
            this.emit('peer:disconnect', pid)
            break
          }
        }
      })

      socket.on('error', () => {
        socket.destroy()
      })
    })

    this.server.listen(this.port, () => {
      this.emit('ready')
    })
  }

  registerSocket(peerId: string, socket: net.Socket) {
    this.sockets.set(peerId, socket)
  }

  send(peerId: string, msg: ProtocolMessage): boolean {
    const socket = this.sockets.get(peerId)
    if (!socket || socket.destroyed) return false
    socket.write(encodeMessage(msg))
    return true
  }

  getSocket(peerId: string): net.Socket | undefined {
    return this.sockets.get(peerId)
  }

  stop() {
    for (const socket of this.allSockets) {
      socket.removeAllListeners()
      socket.destroy()
    }
    this.allSockets.clear()
    this.sockets.clear()
    this.buffers.clear()
    this.server?.close()
    this.server = null
  }
}
