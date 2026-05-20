import { useState, useEffect } from 'react'

interface SharedItem {
  name: string
  size: number
  modified: number
  isDirectory: boolean
}

interface Props {
  peerName: string
  ip: string
  discoveryPort: number
  onClose: () => void
}

export default function SharedFileBrowser({ peerName, ip, discoveryPort, onClose }: Props) {
  const [items, setItems] = useState<SharedItem[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  const loadItems = (path: string) => {
    setLoading(true)
    window.whisperAPI.listPeerFiles(ip, discoveryPort, path).then((res: any) => {
      if (res && res.items) {
        setItems(res.items)
        setCurrentPath(res.currentPath || '')
      }
      setLoading(false)
    })
  }

  useEffect(() => {
    loadItems('')
  }, [ip, discoveryPort])

  const navigateInto = (folderName: string) => {
    const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName
    setSelected(new Set())
    loadItems(nextPath)
  }

  const navigateUp = () => {
    if (!currentPath) return
    const parts = currentPath.split('/')
    parts.pop()
    const nextPath = parts.join('/')
    setSelected(new Set())
    loadItems(nextPath)
  }

  const toggle = (name: string) => {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }

  const selectAllFiles = () => {
    const files = items.filter((i) => !i.isDirectory).map((i) => i.name)
    if (selected.size === files.length) setSelected(new Set())
    else setSelected(new Set(files))
  }

  const download = async () => {
    if (selected.size === 0) return
    setDownloading(true)
    const destDir = await window.whisperAPI.selectDownloadFolder()
    if (!destDir) {
      setDownloading(false)
      return
    }
    const result = await window.whisperAPI.downloadPeerFiles(
      ip,
      discoveryPort,
      Array.from(selected),
      destDir,
      currentPath || undefined
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

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  // Build breadcrumb parts
  const breadcrumbParts = currentPath ? currentPath.split('/') : []

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[560px] max-h-[80vh] flex flex-col border border-gray-700 shadow-xl">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{peerName}님의 공유 폴더</h3>
            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <span className="text-emerald-400 cursor-pointer hover:underline" onClick={() => { setSelected(new Set()); loadItems('') }}>shared</span>
              {breadcrumbParts.map((part, idx) => (
                <span key={idx} className="flex items-center gap-1">
                  <span className="text-gray-600">/</span>
                  <span
                    className={idx === breadcrumbParts.length - 1 ? 'text-gray-300' : 'text-emerald-400 cursor-pointer hover:underline'}
                    onClick={() => {
                      if (idx < breadcrumbParts.length - 1) {
                        const nextPath = breadcrumbParts.slice(0, idx + 1).join('/')
                        setSelected(new Set())
                        loadItems(nextPath)
                      }
                    }}
                  >
                    {part}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {currentPath && (
          <div className="px-4 pt-3">
            <button
              onClick={navigateUp}
              className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded flex items-center gap-1"
            >
              <span>←</span> 상위 폴터
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="text-center text-gray-500 py-8">불러오는 중...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-gray-500 py-8">공유된 항목이 없습니다</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === items.filter((i) => !i.isDirectory).length && items.some((i) => !i.isDirectory)}
                      onChange={selectAllFiles}
                    />
                  </th>
                  <th className="pb-2">이름</th>
                  <th className="pb-2 text-right w-24">크기</th>
                  <th className="pb-2 text-right w-28">수정일</th>
                  <th className="pb-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.name} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2">
                      {!item.isDirectory && (
                        <input type="checkbox" checked={selected.has(item.name)} onChange={() => toggle(item.name)} />
                      )}
                    </td>
                    <td className="py-2 flex items-center gap-2">
                      <span>{item.isDirectory ? '📁' : '📄'}</span>
                      <span className={item.isDirectory ? 'text-emerald-300' : ''}>{item.name}</span>
                    </td>
                    <td className="py-2 text-right text-gray-400">
                      {item.isDirectory ? '—' : formatSize(item.size)}
                    </td>
                    <td className="py-2 text-right text-gray-400">{formatTime(item.modified)}</td>
                    <td className="py-2 text-right">
                      {item.isDirectory ? (
                        <button
                          onClick={() => navigateInto(item.name)}
                          className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
                        >
                          열기
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-400">{selected.size}개 파일 선택됨</span>
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
