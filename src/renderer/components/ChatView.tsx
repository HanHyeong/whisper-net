import { useState, useRef, useEffect } from 'react'
import { Room, ChatMessage, useAppStore } from '../stores/appStore'

interface Props {
  room: Room
  onSendFileAttachment: () => void
  onDownloadAttachment: (msg: ChatMessage) => void
}

function isImageFile(fileName: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function ChatView({ room, onSendFileAttachment, onDownloadAttachment }: Props) {
  const { localPeerId } = useAppStore()
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room.messages])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  const send = () => {
    if (!text.trim()) return
    window.whisperAPI.sendText(room.roomId, text.trim())
    setText('')
    // Reset height after send
    const el = textareaRef.current
    if (el) el.style.height = 'auto'
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col h-full relative">
      <header className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{room.name}</h3>
          <span className="text-xs text-gray-500">{room.members.length}명 참여중 · {room.type === 'public' ? '개방형' : '비밀형'}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSendFileAttachment}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded border border-gray-600"
            title="대화에 파일 첨부 (10MB 이하)"
          >
            📎 파일 첨부
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {room.messages.map((msg: ChatMessage) => (
          <div key={msg.id} className={`flex ${msg.senderId === localPeerId ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-md px-3 py-2 rounded-lg text-sm ${msg.senderId === localPeerId ? 'bg-emerald-700 text-white' : 'bg-gray-700 text-gray-100'}`}>
              {msg.senderId !== localPeerId && <div className="text-xs text-emerald-400 mb-1">{msg.senderName}</div>}

              {msg.attachment ? (
                <div className="space-y-2">
                  {isImageFile(msg.attachment.fileName) && msg.attachment.dataUrl ? (
                    <img
                      src={msg.attachment.dataUrl}
                      alt={msg.attachment.fileName}
                      className="max-w-[240px] max-h-[180px] rounded object-contain cursor-pointer"
                      onClick={() => msg.attachment?.localPath && window.whisperAPI.openFile(msg.attachment.localPath)}
                    />
                  ) : null}
                  <div
                    className="flex items-center gap-2 bg-black/20 rounded px-2 py-1.5 cursor-pointer"
                    onClick={() => msg.attachment?.localPath && window.whisperAPI.openFile(msg.attachment.localPath)}
                  >
                    <span className="text-lg">{isImageFile(msg.attachment.fileName) ? '🖼️' : '📄'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">{msg.attachment.fileName}</div>
                      <div className="text-[10px] opacity-70">{formatFileSize(msg.attachment.fileSize)}</div>
                    </div>
                    {msg.senderId !== localPeerId && (
                      msg.attachment.localPath ? (
                        <span className="text-[10px] bg-emerald-600 px-2 py-0.5 rounded">✓ 받음</span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onDownloadAttachment(msg)
                          }}
                          className="text-[10px] bg-blue-600 hover:bg-blue-500 px-2 py-0.5 rounded"
                        >
                          다운로드
                        </button>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <div>{msg.content}</div>
              )}

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
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="메시지를 입력하세요..."
          rows={1}
          className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none min-h-[40px] max-h-[120px] overflow-y-auto"
        />
        <button onClick={send} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-sm font-medium">전송</button>
      </div>
    </div>
  )
}
