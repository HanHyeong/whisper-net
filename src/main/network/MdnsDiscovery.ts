import { EventEmitter } from 'events'
import { Bonjour } from 'bonjour-service'
import { PeerInfo } from './protocol'

const SERVICE_TYPE = 'whisper'
const SERVICE_PROTOCOL = 'tcp'

/** mDNS는 연결 정보만 발행. 방 목록은 HTTP/TCP 동기화. */
export class MdnsDiscovery extends EventEmitter {
  private bonjour: Bonjour | null = null
  private browser: any = null
  private service: any = null

  constructor(
    private peerId: string,
    private nickname: string,
    private tcpPort: number,
    private discoveryPort: number = 8080,
    private ip: string = ''
  ) {
    super()
  }

  start() {
    this.bonjour = new Bonjour()

    this.service = this.bonjour.publish({
      name: `whisper-${this.peerId}`,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port: this.tcpPort,
      txt: {
        peerId: this.peerId,
        nickname: this.nickname,
        discoveryPort: String(this.discoveryPort),
        ip: this.ip,
      },
    })

    this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL })
    this.browser.on('up', (service: any) => {
      if (service.txt?.peerId === this.peerId) return
      const ip = service.txt?.ip || service.addresses?.find((a: string) => a.includes('.')) || service.host
      this.emit('peer:found', {
        peerId: service.txt?.peerId || service.name,
        nickname: service.txt?.nickname || 'Unknown',
        ip,
        tcpPort: service.port,
        discoveryPort: parseInt(service.txt?.discoveryPort) || 8080,
        rooms: [] as PeerInfo['rooms'],
      })
    })

    this.browser.on('txt-update', (service: any) => {
      if (service.txt?.peerId === this.peerId) return
      const ip = service.txt?.ip || service.addresses?.find((a: string) => a.includes('.')) || service.host
      this.emit('peer:found', {
        peerId: service.txt?.peerId || service.name,
        nickname: service.txt?.nickname || 'Unknown',
        ip,
        tcpPort: service.port,
        discoveryPort: parseInt(service.txt?.discoveryPort) || 8080,
        rooms: [] as PeerInfo['rooms'],
      })
    })

    this.browser.on('down', (service: any) => {
      if (service.txt?.peerId) {
        this.emit('peer:left', service.txt.peerId)
      }
    })
  }

  setNickname(nickname: string) {
    this.nickname = nickname
    if (this.service?.txt) {
      this.service.txt.nickname = nickname
    }
  }

  stop() {
    this.browser?.stop?.()
    this.service?.stop?.()
    this.bonjour?.destroy?.()
  }
}
