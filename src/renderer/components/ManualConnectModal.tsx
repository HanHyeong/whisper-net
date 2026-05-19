import { useState } from 'react'

interface Props {
  onClose: () => void
  onConnect: (ip: string, port: number) => void
}

export default function ManualConnectModal({ onClose, onConnect }: Props) {
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('41235')

  const submit = () => {
    const p = parseInt(port, 10)
    if (!ip.trim() || isNaN(p)) return
    onConnect(ip.trim(), p)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-80 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4">수동 연결</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">IP 주소</label>
            <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.0.0.5" className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">TCP 포트</label>
            <input value={port} onChange={(e) => setPort(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600">취소</button>
          <button onClick={submit} className="px-4 py-2 rounded text-sm bg-emerald-600 hover:bg-emerald-500">연결</button>
        </div>
      </div>
    </div>
  )
}
