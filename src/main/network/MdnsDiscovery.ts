import { EventEmitter } from 'events'
import { Bonjour } from 'bonjour-service'
import { PeerInfo } from './protocol'

const SERVICE_TYPE = 'whisper'
const SERVICE_PROTOCOL = 'tcp'

export class MdnsDiscovery extends EventEmitter {
  private bonjour: Bonjour | null = null
  private browser: any = null
  private service: any = null

  constructor(
    private peerId: string,
    private nickname: string,
    private tcpPort: number,
    private rooms: PeerInfo['rooms'] = [],
    private discoveryPort: number = 8080,
    private ip: string = ''
  ) {
    super()
  }

  start() {
    this.bonjour = new Bonjour()

    // publish ourselves
    this.service = this.bonjour.publish({
      name: `whisper-${this.peerId}`,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port: this.tcpPort,
      txt: {
        peerId: this.peerId,
        nickname: this.nickname,
        rooms: JSON.stringify(this.rooms),
        discoveryPort: String(this.discoveryPort),
        ip: this.ip,
      },
    })

    // browse for others
    this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL })
    this.browser.on('up', (service: any) => {
      if (service.txt?.peerId === this.peerId) return
      // Use the IP from TXT record first to avoid .local domain issues on Windows
      const ip = service.txt?.ip || service.addresses?.find((a: string) => a.includes('.')) || service.host
      const peer = {
        peerId: service.txt?.peerId || service.name,
        nickname: service.txt?.nickname || 'Unknown',
        ip,
        tcpPort: service.port,
        discoveryPort: parseInt(service.txt?.discoveryPort) || 8080,
        rooms: [],
      }
      try {
        if (service.txt?.rooms) {
          peer.rooms = JSON.parse(service.txt.rooms)
        }
      } catch {}
      this.emit('peer:found', peer)
    })

    this.browser.on('down', (service: any) => {
      if (service.txt?.peerId) {
        this.emit('peer:left', service.txt.peerId)
      }
    })
  }

  setNickname(nickname: string) {
    this.nickname = nickname
    if (this.service) {
      this.service.txt.nickname = nickname
    }
  }

  setRooms(rooms: PeerInfo['rooms']) {
    this.rooms = rooms
    if (this.service) {
      this.service.txt.rooms = JSON.stringify(rooms)
    }
  }

  stop() {
    this.browser?.stop?.()
    this.service?.stop?.()
    this.bonjour?.destroy?.()
  }
}
