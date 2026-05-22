import { EventEmitter } from 'events'
import { PeerInfo } from '../network/protocol'
import { httpGet } from '../utils/http'
import { loadConfig } from '../utils/config'
import { UpdateDownloader } from './UpdateDownloader'
import { UpdateVerifier } from './UpdateVerifier'
import {
  channelPointerSharePath,
  channelSigSharePath,
  UPDATE_VERIFIED_PREFIX,
} from './paths'
import {
  DEFAULT_UPDATE_SETTINGS,
  UpdateChannel,
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateProgress,
  UpdateSettings,
} from './types'

export interface UpdateServiceDeps {
  getPeers: () => PeerInfo[]
  getSharedPath: () => string | null
  currentVersion: string
  enabled: boolean
}

export class UpdateService extends EventEmitter {
  private verifier: UpdateVerifier
  private downloader: UpdateDownloader
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private lastCheckResult: UpdateCheckResult | null = null

  constructor(private deps: UpdateServiceDeps) {
    super()
    const config = loadConfig()
    const extraKeys = config.update?.trustedPublisherKeys ?? {}
    this.verifier = new UpdateVerifier(deps.currentVersion, extraKeys)
    this.downloader = new UpdateDownloader({
      getSharedPath: deps.getSharedPath,
      verifier: this.verifier,
      onProgress: (p) => this.emit('progress', p),
    })
  }

  getSettings(): UpdateSettings {
    const config = loadConfig()
    return { ...DEFAULT_UPDATE_SETTINGS, ...config.update }
  }

  scheduleCheck(options?: { delayMs?: number; intervalMs?: number }) {
    if (!this.deps.enabled) return

    const settings = this.getSettings()
    const delayMs = options?.delayMs ?? 30_000
    const intervalMs = options?.intervalMs ?? settings.checkIntervalHours * 60 * 60 * 1000

    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.checkTimer) clearInterval(this.checkTimer)

    if (settings.checkOnStartup) {
      this.startupTimer = setTimeout(() => {
        void this.checkForUpdates().then((result) => {
          if (result.status === 'available') {
            this.emit('available', result)
          }
        })
      }, delayMs)
    }

    this.checkTimer = setInterval(() => {
      void this.checkForUpdates().then((result) => {
        if (result.status === 'available') {
          this.emit('available', result)
        }
      })
    }, intervalMs)
  }

  async checkForUpdates(channel?: UpdateChannel): Promise<UpdateCheckResult> {
    if (!this.deps.enabled) {
      return {
        status: 'error',
        currentVersion: this.deps.currentVersion,
        channel: channel ?? 'stable',
        error: 'not_found',
        message: '업데이트 확인이 비활성화되어 있습니다.',
      }
    }

    const settings = this.getSettings()
    const targetChannel = channel ?? settings.channel
    const peers = this.orderPeers(this.deps.getPeers(), settings.preferredOriginPeerId)

    if (peers.length === 0) {
      const result: UpdateCheckResult = {
        status: 'error',
        currentVersion: this.deps.currentVersion,
        channel: targetChannel,
        message: '연결된 피어가 없습니다.',
      }
      this.lastCheckResult = result
      return result
    }

    for (const peer of peers) {
      const result = await this.checkPeer(peer, targetChannel)
      if (result.status === 'available') {
        this.lastCheckResult = result
        return result
      }
      if (result.status === 'error' && result.error === 'bad_signature') {
        this.logAudit(`reject bad_signature peer=${peer.peerId}`)
      }
    }

    const upToDate: UpdateCheckResult = {
      status: 'up_to_date',
      currentVersion: this.deps.currentVersion,
      channel: targetChannel,
      message: '최신 버전입니다.',
    }
    this.lastCheckResult = upToDate
    return upToDate
  }

  async downloadUpdate(checkResult?: UpdateCheckResult): Promise<UpdateDownloadResult> {
    const result = checkResult ?? this.lastCheckResult
    if (!result || result.status !== 'available' || !result.manifest || !result.artifact || !result.source) {
      return { ok: false, message: '다운로드할 업데이트가 없습니다.' }
    }

    const local = this.downloader.findLocalInstaller(result.manifest.manifestId, result.artifact)
    if (local) {
      return {
        ok: true,
        manifestId: result.manifest.manifestId,
        version: result.manifest.version,
        installerPath: local,
      }
    }

    return this.downloader.downloadFromPeer(
      result.source.ip,
      result.source.discoveryPort,
      result.manifest,
      result.artifact
    )
  }

  getLastCheckResult(): UpdateCheckResult | null {
    return this.lastCheckResult
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.checkTimer) clearInterval(this.checkTimer)
    this.startupTimer = null
    this.checkTimer = null
  }

  private orderPeers(peers: PeerInfo[], preferredPeerId?: string): PeerInfo[] {
    if (!preferredPeerId) return peers
    const preferred = peers.find((p) => p.peerId === preferredPeerId)
    if (!preferred) return peers
    return [preferred, ...peers.filter((p) => p.peerId !== preferredPeerId)]
  }

  private async checkPeer(peer: PeerInfo, channel: UpdateChannel): Promise<UpdateCheckResult> {
    const base: UpdateCheckResult = {
      status: 'error',
      currentVersion: this.deps.currentVersion,
      channel,
    }

    try {
      const channelPath = channelPointerSharePath(channel)
      const channelSigPath = channelSigSharePath(channel)
      const channelJson = await httpGet(this.shareUrl(peer.ip, peer.discoveryPort, channelPath), 5000)
      const channelSig = (await httpGet(this.shareUrl(peer.ip, peer.discoveryPort, channelSigPath), 5000)).trim()

      const pointerResult = this.verifier.verifyChannelPointer(channelJson, channelSig)
      if (!pointerResult.ok || !pointerResult.data) {
        return { ...base, error: pointerResult.error, message: pointerResult.message }
      }
      const pointer = pointerResult.data

      if (!this.verifier.isNewerVersion(pointer.version)) {
        return { ...base, status: 'up_to_date', message: '최신 버전입니다.' }
      }

      const manifestShare = `${UPDATE_VERIFIED_PREFIX}/${pointer.manifestPath}`
      const manifestSigShare = `${UPDATE_VERIFIED_PREFIX}/${pointer.manifestSigPath}`
      const manifestJson = await httpGet(this.shareUrl(peer.ip, peer.discoveryPort, manifestShare), 8000)
      const manifestSig = (await httpGet(this.shareUrl(peer.ip, peer.discoveryPort, manifestSigShare), 5000)).trim()

      const manifestResult = this.verifier.verifyManifest(manifestJson, manifestSig)
      if (!manifestResult.ok || !manifestResult.data) {
        return { ...base, error: manifestResult.error, message: manifestResult.message }
      }

      const consistency = this.verifier.validateChannelManifestConsistency(pointer, manifestResult.data)
      if (!consistency.ok) {
        return { ...base, error: consistency.error, message: consistency.message }
      }

      const artifactResult = this.verifier.pickArtifact(manifestResult.data)
      if (!artifactResult.ok || !artifactResult.artifact) {
        return { ...base, error: artifactResult.error, message: artifactResult.message }
      }

      this.logAudit(`available ${manifestResult.data.version} from ${peer.peerId}`)

      return {
        status: 'available',
        currentVersion: this.deps.currentVersion,
        channel,
        manifest: manifestResult.data,
        artifact: artifactResult.artifact,
        source: {
          peerId: peer.peerId,
          nickname: peer.nickname,
          ip: peer.ip,
          discoveryPort: peer.discoveryPort,
        },
        message: manifestResult.data.releaseNotes,
      }
    } catch {
      return { ...base, message: `${peer.nickname}에서 업데이트 정보를 가져올 수 없습니다.` }
    }
  }

  private shareUrl(ip: string, port: number, relativePath: string): string {
    const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
    return `http://${ip}:${port}/whisper/share/${encoded}`
  }

  private logAudit(message: string) {
    this.emit('audit', message)
  }
}

export type { UpdateProgress }
