import { useState, useEffect } from 'react'

interface SharedFile {
  name: string
  size: number
  modified: number
}

interface Props {
  peerName: string
  ip: string
  discoveryPort: number
  onClose: () => void
}

export default function SharedFileBrowser({ peerName, ip, discoveryPort, onClose }: Props) {
  const [files, setFiles] = useState<SharedFile[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    window.whisperAPI.listPeerFiles(ip, discoveryPort).then((res: any) => {
      if (res && res.files) {
        setFiles(res.files)
      }
      setLoading(false)
    })
  }, [ip, discoveryPort])

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }

  const selectAll = () => {
    if (selected.size === files.length) setSelected(new Set())
    else setSelected(new Set(files.map((f) => f.name)))
  }

  const download = async () => {
    if (selected.size === 0) return
    setDownloading(true)
    const destDir = await window.whisperAPI.setSharedFolder() // reuse folder picker for dest
    if (!destDir) {
      setDownloading(false)
      return
    }
    const result = await window.whisperAPI.downloadPeerFiles(
      ip,
      discoveryPort,
      Array.from(selected),
      destDir
    )
    setDownloading(false)
    const okCount = result.filter((r: any) => r.status === 'ok').length
    alert(`${okCount}/${selected.size}개 파일 다운로드 완료`)
    setSelected(new Set())
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[480px] max-h-[80vh] flex flex-col border border-gray-700 shadow-xl">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold">{peerName}님의 공유 폴��</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-center text-gray-500 py-8">불러오는 중...</div>
          ) : files.length === 0 ? (
            <div className="text-center text-gray-500 py-8">공유된 파일이 없습니다</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 w-8">
                    <input type="checkbox" checked={selected.size === files.length && files.length > 0} onChange={selectAll} />
                  </th>
                  <th className="pb-2">파일명</th>
                  <th className="pb-2 text-right">크기</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.name} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2">
                      <input type="checkbox" checked={selected.has(f.name)} onChange={() => toggle(f.name)} />
                    </td>
                    <td className="py-2">{f.name}</td>
                    <td className="py-2 text-right text-gray-400">{formatSize(f.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-400">{selected.size}개 선택됨</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600">닫기</button>
            <button
              onClick={download}
              disabled={selected.size === 0 || downloading}
              className="px-4 py-2 rounded text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
            >
              {downloading ? '다운로드 중...' : '선택한 파일 다운로드'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
