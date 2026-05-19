import { useState } from 'react'

interface Props {
  roomName: string
  roomId: string
  roomType: 'public' | 'private'
  onClose: () => void
  onJoin: (roomId: string, password?: string) => void
}

export default function JoinRoomModal({ roomName, roomId, roomType, onClose, onJoin }: Props) {
  const [password, setPassword] = useState('')

  const submit = () => {
    if (roomType === 'private' && !password.trim()) return
    onJoin(roomId, roomType === 'private' ? password : undefined)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-80 border border-gray-700">
        <h3 className="text-lg font-semibold mb-1">Join Room</h3>
        <p className="text-sm text-gray-400 mb-4 truncate">{roomName}</p>

        {roomType === 'private' && (
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Enter password"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none"
              autoFocus
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600">Cancel</button>
          <button
            onClick={submit}
            disabled={roomType === 'private' && !password.trim()}
            className="px-4 py-2 rounded text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
          >
            Join
          </button>
        </div>
      </div>
    </div>
  )
}
