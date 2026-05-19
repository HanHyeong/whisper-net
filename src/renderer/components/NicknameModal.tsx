import { useState } from 'react'

interface Props {
  initial?: string
  onSave: (nickname: string) => void
}

export default function NicknameModal({ initial = '', onSave }: Props) {
  const [nickname, setNickname] = useState(initial)

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-80 border border-gray-700">
        <h3 className="text-lg font-semibold mb-1">닉네임 설정</h3>
        <p className="text-xs text-gray-400 mb-4">네트워크에 표시될 이름을 입력하세요.</p>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && nickname.trim() && onSave(nickname.trim())}
          placeholder="예: 김개발"
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:border-emerald-500 outline-none mb-4"
          autoFocus
        />
        <button
          onClick={() => nickname.trim() && onSave(nickname.trim())}
          disabled={!nickname.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-2 rounded text-sm font-medium"
        >
          시작하기
        </button>
      </div>
    </div>
  )
}
