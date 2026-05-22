export const UPDATE_ROOT = '_whisper-updates'
export const UPDATE_VERIFIED_PREFIX = '_whisper-updates/verified'
export const UPDATE_INCOMING_DIR = 'incoming'
export const UPDATE_VERIFIED_DIR = 'verified'

/** 공유폴더 브라우저·목록 API에서 숨길 시스템 디렉터리 */
export const HIDDEN_SHARE_DIR_NAMES = new Set(['_roomsFiles', '_whisper-updates'])

export function isHiddenShareBrowsePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return false
  const firstSegment = normalized.split('/')[0]
  return HIDDEN_SHARE_DIR_NAMES.has(firstSegment)
}

export function isHiddenShareEntry(name: string): boolean {
  return HIDDEN_SHARE_DIR_NAMES.has(name)
}

export const ALLOWED_UPDATE_EXTENSIONS = new Set([
  '.json',
  '.sig',
  '.dmg',
  '.exe',
  '.appimage',
])

export function channelPointerSharePath(channel: string): string {
  return `${UPDATE_VERIFIED_PREFIX}/channels/${channel}.json`
}

export function channelSigSharePath(channel: string): string {
  return `${UPDATE_VERIFIED_PREFIX}/channels/${channel}.json.sig`
}

export function isAllowedUpdateSharePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized.startsWith(`${UPDATE_VERIFIED_PREFIX}/`)) {
    return false
  }
  if (normalized.includes('/incoming/') || normalized.endsWith('/state.json')) {
    return false
  }
  const lower = normalized.toLowerCase()
  for (const ext of ALLOWED_UPDATE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true
  }
  return false
}
