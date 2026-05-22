import { EventEmitter } from 'events'
import { PeerInfo, ProtocolMessage } from '../network/protocol'
import { UpdateServeBridge } from '../network/TcpDiscovery'
import { httpGet } from '../utils/http'
import { loadConfig } from '../utils/config'
import { UpdateAvailabilityStore } from './UpdateAvailabilityStore'
import { UpdateDownloader } from './UpdateDownloader'
import { UpdateMirrorRegistry } from './UpdateMirrorRegistry'
import { rankDownloadSources, rankProbePeers } from './UpdateSourceSelector'
import { UpdateVerifier } from './UpdateVerifier'
import {
  channelPointerSharePath,
  channelSigSharePath,
  UPDATE_VERIFIED_PREFIX,
} from './paths'
import {
  DEFAULT_UPDATE_SETTINGS,
  MirrorStatus,
  UpdateAvailabilityPayload,
  UpdateChannel,
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateProgress,
  UpdateSettings,
  UpdateSourceCandidate,
} from './types'

export interface UpdateServiceDeps {
  getPeers: () => PeerInfo[]
  getSharedPath: () => string | null
  currentVersion: string
  enabled: boolean
  localPeerId: string
  localNickname: string
}

const GOSSIP_FANOUT = 3
const MAX_DOWNLOAD_ATTEMPTS = 5

export class UpdateService extends EventEmitter implements UpdateServeBridge {
  private verifier: UpdateVerifier
  private downloader: UpdateDownloader
  private mirrorRegistry: UpdateMirrorRegistry
  private availabilityStore = new UpdateAvailabilityStore()
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private gossipTimer: ReturnType<typeof setTimeout> | null = null
  private lastCheckResult: UpdateCheckResult | null = null
  private sendDirect: ((peerId: string, msg: ProtocolMessage) => void) | null = null

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
    this.mirrorRegistry = new UpdateMirrorRegistry({
      getVerifiedDir: () => this.downloader.getVerifiedDir(),
      getSharedPath: deps.getSharedPath,
      getSettings: () => this.getSettings(),
      getPlatformArch: () => ({ platform: process.platform, arch: process.arch }),
    })
  }

  setSendDirect(fn: (peerId: string, msg: ProtocolMessage) => void) {
    this.sendDirect = fn
  }

  initializeMirror() {
    if (!this.deps.enabled) return
    this.mirrorRegistry.scanLocal()
    if (this.mirrorRegistry.canSendAvailability()) {
      this.gossipTimer = setTimeout(() => this.gossipAvailability(), 5000)
    }
  }

  getSettings(): UpdateSettings {
    const config = loadConfig()
    return { ...DEFAULT_UPDATE_SETTINGS, ...config.update }
  }

  getMirrorStatus(): MirrorStatus {
    return this.mirrorRegistry.getMirrorStatus()
  }

  getUpdateInfo() {
    const availability = this.mirrorRegistry.getLocalAvailability()
    if (!availability) return null
    return {
      channels: [availability.channel],
      availability: [availability],
    }
  }

  tryBeginServe(relativePath: string): boolean {
    return this.mirrorRegistry.tryBeginServe(relativePath)
  }

  endServe() {
    this.mirrorRegistry.endServe()
  }

  resolveUpdateFile(relativePath: string): string | null {
    return this.mirrorRegistry.resolveUpdateShareFile(relativePath)
  }

  getLocalUpdateInfo() {
    return this.getUpdateInfo()
  }

  tryBeginUpdateServe(relativePath: string): boolean {
    return this.tryBeginServe(relativePath)
  }

  endUpdateServe() {
    this.endServe()
  }

  resolveUpdateShareFile(relativePath: string): string | null {
    return this.resolveUpdateFile(relativePath)
  }

  handleAvailabilityGossip(peerId: string, payload: UpdateAvailabilityPayload) {
    this.availabilityStore.upsert(peerId, payload)
  }

  onPeerLeft(peerId: string) {
    this.availabilityStore.remove(peerId)
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
    const peers = rankProbePeers(
      this.deps.getPeers(),
      this.availabilityStore,
      targetChannel,
      this.deps.currentVersion,
      settings.preferredOriginPeerId
    )

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
        const mirrorCount = this.countMirrors(result.manifest!.manifestId, result.artifact!.sha256)
        result.mirrorCount = mirrorCount
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

    const primarySource: UpdateSourceCandidate = {
      peerId: result.source.peerId,
      nickname: result.source.nickname,
      ip: result.source.ip,
      discoveryPort: result.source.discoveryPort,
      role: result.source.role ?? 'origin',
      activeServes: 0,
    }

    const sources = rankDownloadSources(
      this.deps.getPeers(),
      this.availabilityStore,
      result.manifest,
      result.artifact,
      primarySource
    )

    for (const source of sources.slice(0, MAX_DOWNLOAD_ATTEMPTS)) {
      this.logAudit(`download attempt from ${source.peerId} role=${source.role}`)
      const dl = await this.downloader.downloadFromPeer(
        source.ip,
        source.discoveryPort,
        result.manifest,
        result.artifact
      )
      if (dl.ok) {
        this.mirrorRegistry.registerAfterDownload(result.manifest, result.artifact)
        this.gossipAvailability()
        return dl
      }
    }

    return { ok: false, message: '모든 미러·Origin에서 다운로드에 실패했습니다.' }
  }

  getLastCheckResult(): UpdateCheckResult | null {
    return this.lastCheckResult
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer)
    if (this.checkTimer) clearInterval(this.checkTimer)
    if (this.gossipTimer) clearTimeout(this.gossipTimer)
    this.startupTimer = null
    this.checkTimer = null
    this.gossipTimer = null
  }

  private async checkPeer(peer: PeerInfo, channel: UpdateChannel): Promise<UpdateCheckResult> {
    const base: UpdateCheckResult = {
      status: 'error',
      currentVersion: this.deps.currentVersion,
      channel,
    }

    try {
      const gossip = this.availabilityStore.get(peer.peerId)
      if (gossip && gossip.channel === channel && this.verifier.isNewerVersion(gossip.version)) {
        return this.checkPeerViaGossip(peer, gossip, channel, base)
      }

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

      return this.fetchManifestFromPeer(
        peer,
        channel,
        `${UPDATE_VERIFIED_PREFIX}/${pointer.manifestPath}`,
        `${UPDATE_VERIFIED_PREFIX}/${pointer.manifestSigPath}`,
        base,
        gossip?.role
      )
    } catch {
      return { ...base, message: `${peer.nickname}에서 업데이트 정보를 가져올 수 없습니다.` }
    }
  }

  private async checkPeerViaGossip(
    peer: PeerInfo,
    gossip: UpdateAvailabilityPayload,
    channel: UpdateChannel,
    base: UpdateCheckResult
  ): Promise<UpdateCheckResult> {
    const manifestShare = `${UPDATE_VERIFIED_PREFIX}/${gossip.manifestRelativePath}`
    const manifestSigShare = `${UPDATE_VERIFIED_PREFIX}/${gossip.manifestSigRelativePath}`
    return this.fetchManifestFromPeer(peer, channel, manifestShare, manifestSigShare, base, gossip.role)
  }

  private async fetchManifestFromPeer(
    peer: PeerInfo,
    channel: UpdateChannel,
    manifestShare: string,
    manifestSigShare: string,
    base: UpdateCheckResult,
    role?: 'origin' | 'mirror'
  ): Promise<UpdateCheckResult> {
    const manifestJson = await httpGet(this.shareUrl(peer.ip, peer.discoveryPort, manifestShare), 8000)
    const manifestSig = (await httpGet(this.shareUrl(peer.ip, peer.discoveryPort, manifestSigShare), 5000)).trim()

    const manifestResult = this.verifier.verifyManifest(manifestJson, manifestSig)
    if (!manifestResult.ok || !manifestResult.data) {
      return { ...base, error: manifestResult.error, message: manifestResult.message }
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
        role: role ?? 'origin',
      },
      message: manifestResult.data.releaseNotes,
    }
  }

  private countMirrors(manifestId: string, artifactSha256: string): number {
    return this.availabilityStore.listMatching(manifestId, artifactSha256).filter(
      (e) => e.payload.role === 'mirror'
    ).length
  }

  private gossipAvailability() {
    if (!this.sendDirect || !this.mirrorRegistry.canSendAvailability()) return

    const payload = this.mirrorRegistry.getLocalAvailability()
    if (!payload) return

    const peers = this.deps
      .getPeers()
      .filter((p) => p.peerId !== this.deps.localPeerId)
    const targets = this.shuffleArray(peers).slice(0, GOSSIP_FANOUT)

    for (const peer of targets) {
      this.sendDirect(peer.peerId, {
        type: 'update_availability',
        peerId: this.deps.localPeerId,
        nickname: this.deps.localNickname,
        timestamp: Date.now(),
        payload,
      })
    }
    this.logAudit(`gossip availability v${payload.version} to ${targets.length} peers`)
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
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
