import { useState, useRef, useEffect } from 'react'
import { Room, ChatMessage, useAppStore } from '../stores/appStore'

interface Props {
  room: Room
  onSendFile: (peerId: string) => void
}

export default function ChatView({ room, onSendFile }: Props) {
  const { localPeerId } = useAppStore()
  const [text, setText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room.messages])

  const send = () => {
    if (!text.trim()) return
    window.whisperAPI.sendText(room.roomId, text.trim())
    setText('')
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    // For simplicity, send to first other member in room
    const target = room.members.find((m) => m !== localPeerId)
    if (target) {
      onSendFile(target)
    }
  }

  const otherMembers = room.members.filter((m) => m !== localPeerId)

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 bg-emerald-900/50 border-2 border-dashed border-emerald-400 z-10 flex items-center justify-center pointer-events-none">
          <span className="text-emerald-300 font-semibold">파일을 여기에 놓아 전송</span>
        </div>
      )}

      <header className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{room.name}</h3>
          <span className="text-xs text-gray-500">{room.members.length}명 참여중 · {room.type === 'public' ? '개방형' : '비밀형'}</span>
        </div>
        {otherMembers.length === 1 && (
          <button
            onClick={() => onSendFile(otherMembers[0])}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded border border-gray-600"
          >
            📎 파일 별내기
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {room.messages.map((msg: ChatMessage) => (
          <div key={msg.id} className={`flex ${msg.senderId === localPeerId ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-md px-3 py-2 rounded-lg text-sm ${msg.senderId === localPeerId ? 'bg-emerald-700 text-white' : 'bg-gray-700 text-gray-100'}`}>
              {msg.senderId !== localPeerId && <div className="text-xs text-emerald-400 mb-1">{msg.senderName}</div>}
              <div>{msg.content}</div>
              <div className="text-[10px] text-right mt-1 opacity-60">{formatTime(msg.timestamp)}</div>
            </div>
          </div>
        ))}
        {room.messages.length === 0 && (
          <div className="text-center text-gray-600 text-sm mt-10">
            아직 메시지가 없습니다.<br />
            {room.type === 'private' && '비밀번호를 알고 있는 사람만 참여할 수 있습니다.'}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-gray-700 bg-gray-800 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="메시지를 입력하세요..."
          className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
        />
        <button onClick={send} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-sm font-medium">전송</button>
      </div>
    </div>
  )
}
