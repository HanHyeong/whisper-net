import { useState } from 'react'

interface Props {
  onClose: () => void
  onCreated: (room: any) => void
}

export default function CreateRoomModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'public' | 'private'>('public')
  const [password, setPassword] = useState('')

  const submit = async () => {
    if (!name.trim()) return
    const room = await window.whisperAPI.createRoom(name.trim(), type, type === 'private' ? password : undefined)
    if (room) onCreated(room)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700 shadow-xl">
        <h3 className="text-lg font-semibold mb-4">새 대화방 만들기</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">방 이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">유형</label>
            <div className="flex gap-2">
              <button onClick={() => setType('public')} className={`flex-1 py-2 rounded text-sm ${type === 'public' ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-300'}`}>개방형</button>
              <button onClick={() => setType('private')} className={`flex-1 py-2 rounded text-sm ${type === 'private' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'}`}>비밀형</button>
            </div>
          </div>
          {type === 'private' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">비밀번호</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600">취소</button>
          <button onClick={submit} className="px-4 py-2 rounded text-sm bg-emerald-600 hover:bg-emerald-500">만들기</button>
        </div>
      </div>
    </div>
  )
}
