import { useEffect, useState } from 'react'

interface UpdateCheckResult {
  status: 'up_to_date' | 'available' | 'error'
  currentVersion: string
  channel: string
  manifest?: { version: string; releaseNotes: string; publisherKeyId: string }
  source?: { nickname: string }
  message?: string
}

interface UpdateDownloadResult {
  ok: boolean
  version?: string
  installerPath?: string
  message?: string
}

interface Props {
  currentVersion: string
  onClose: () => void
}

type Phase = 'idle' | 'checking' | 'available' | 'up_to_date' | 'downloading' | 'ready' | 'error'

export default function UpdateModal({ currentVersion, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null)
  const [downloadResult, setDownloadResult] = useState<UpdateDownloadResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    const unsubProgress = window.whisperAPI.onUpdateProgress((p) => {
      setProgress(p.percent)
      if (p.message) setStatusMessage(p.message)
      if (p.phase === 'downloading' || p.phase === 'verifying') setPhase('downloading')
      if (p.phase === 'ready') setPhase('ready')
      if (p.phase === 'error') setPhase('error')
    })
    return () => {
      unsubProgress()
    }
  }, [])

  const handleCheck = async () => {
    setPhase('checking')
    setStatusMessage('업데이트 확인 중…')
    setDownloadResult(null)
    const result: UpdateCheckResult = await window.whisperAPI.checkForUpdates()
    setCheckResult(result)
    if (result.status === 'available') {
      setPhase('available')
      setStatusMessage(result.manifest?.releaseNotes || '새 버전을 사용할 수 있습니다.')
    } else if (result.status === 'up_to_date') {
      setPhase('up_to_date')
      setStatusMessage(result.message || '최신 버전입니다.')
    } else {
      setPhase('error')
      setStatusMessage(result.message || '업데이트 확인에 실패했습니다.')
    }
  }

  const handleDownload = async () => {
    setPhase('downloading')
    setProgress(0)
    setStatusMessage('다운로드 준비 중…')
    const result: UpdateDownloadResult = await window.whisperAPI.downloadUpdate()
    setDownloadResult(result)
    if (result.ok && result.installerPath) {
      setPhase('ready')
      setStatusMessage('다운로드 및 검증이 완료되었습니다.')
    } else {
      setPhase('error')
      setStatusMessage(result.message || '다운로드에 실패했습니다.')
    }
  }

  const handleOpenInstaller = async () => {
    const installerPath = downloadResult?.installerPath
    if (!installerPath) return
    await window.whisperAPI.openUpdateInstaller(installerPath)
  }

  const newVersion = checkResult?.manifest?.version
  const sourceName = checkResult?.source?.nickname

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-1">업데이트</h3>
        <p className="text-sm text-gray-400 mb-4">
          현재 버전 v{currentVersion}
          {newVersion ? ` → v${newVersion}` : ''}
        </p>

        {sourceName && phase === 'available' && (
          <p className="text-xs text-emerald-400 mb-3">출처: {sourceName} (LAN)</p>
        )}

        {checkResult?.manifest?.publisherKeyId && (
          <p className="text-[10px] text-gray-500 mb-3">
            서명 키: {checkResult.manifest.publisherKeyId}
          </p>
        )}

        <div className="min-h-[48px] text-sm text-gray-300 mb-4">{statusMessage}</div>

        {(phase === 'downloading' || phase === 'ready') && (
          <div className="w-full bg-gray-700 rounded-full h-2 mb-4">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            닫기
          </button>

          {(phase === 'idle' || phase === 'error' || phase === 'up_to_date') && (
            <button
              onClick={handleCheck}
              className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              확인
            </button>
          )}

          {phase === 'available' && (
            <button
              onClick={handleDownload}
              className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              다운로드
            </button>
          )}

          {phase === 'ready' && downloadResult?.installerPath && (
            <button
              onClick={handleOpenInstaller}
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              설치 파일 열기
            </button>
          )}
        </div>

        {phase === 'ready' && (
          <p className="text-[10px] text-gray-500 mt-4 leading-relaxed">
            macOS: 우클릭 → 열기 · Windows: SmartScreen 경고 시 &quot;추가 정보&quot; → 실행
          </p>
        )}
      </div>
    </div>
  )
}
