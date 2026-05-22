import { useEffect, useRef, useState } from 'react'
import { useAppStore, Peer, ChatMessage } from './stores/appStore'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import CreateRoomModal from './components/CreateRoomModal'
import NicknameModal from './components/NicknameModal'
import ManualConnectModal from './components/ManualConnectModal'
import SharedFileBrowser from './components/SharedFileBrowser'
import JoinRoomModal from './components/JoinRoomModal'
import LeaveRoomModal from './components/LeaveRoomModal'

export default function App() {
  const {
    peers, rooms, localPeerId, localNickname, sharedFolder, transfers,
    setPeers, setLocalPeerId, setLocalNickname, setSharedFolder, setRooms,
    addRoom, addMessage, setActiveRoom, activeRoomId,
    addTransfer, updateTransfer, removeTransfer,
    unreadCounts, incrementUnread, clearUnread,
    updateMessageAttachment,
  } = useAppStore()

  const [showCreate, setShowCreate] = useState(false)
  const [showNickname, setShowNickname] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [browsePeer, setBrowsePeer] = useState<Peer | null>(null)
  const [pendingJoinRoom, setPendingJoinRoom] = useState<{ roomId: string; name: string; type: 'public' | 'private' } | null>(null)
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [showNotificationPreview, setShowNotificationPreview] = useState(true)
  const [leaveTargetRoom, setLeaveTargetRoom] = useState<{ roomId: string; name: string; isLastMember: boolean } | null>(null)

  // Keep latest activeRoomId in ref to avoid stale closure in event handlers
  const activeRoomIdRef = useRef(activeRoomId)
  activeRoomIdRef.current = activeRoomId

  useEffect(() => {
    const unsubPeers = window.whisperAPI.onPeers((list) => setPeers(list))
    const unsubRooms = window.whisperAPI.onRooms((list) => setRooms(list))
    const unsubJoinRejected = window.whisperAPI.onJoinRejected((info) => {
      setShowJoinModal(false)
      setPendingJoinRoom(null)
      setAlertMessage(
        info.reason === 'wrong_password' ? '비밀번호가 틀렸습니다.' : '방 참여가 거부되었습니다.'
      )
    })
    const unsubRoomJoined = window.whisperAPI.onRoomJoined((roomId) => {
      setShowJoinModal(false)
      setPendingJoinRoom(null)
      setActiveRoom(roomId)
      clearUnread(roomId)
    })
    const unsubMsg = window.whisperAPI.onMessage((msg) => {
      addMessage(msg)
      // Increment unread if message is for a non-active room
      if (msg.roomId !== activeRoomIdRef.current) {
        incrementUnread(msg.roomId)
      }
    })
    const unsubOffer = window.whisperAPI.onFileOffer((offer) => {
      const ok = window.confirm(`${offer.fromName} 님이 파일 "${offer.fileName}" (${(offer.fileSize / 1024).toFixed(1)}KB) 전송을 요청했습니다. 수락할까요?`)
      if (ok) {
        window.whisperAPI.acceptFile(offer.from, offer.transferId, offer.fileName).then((res: any) => {
          if (res) {
            addTransfer({
              transferId: offer.transferId,
              fileName: offer.fileName,
              direction: 'download',
              received: 0,
              total: offer.fileSize,
              peerId: offer.from,
              status: 'transferring',
              savePath: res.savePath,
            })
          }
        })
      }
    })
    const unsubLocal = window.whisperAPI.onLocal((info) => {
      setLocalPeerId(info.peerId)
      setLocalNickname(info.nickname)
    })
    const unsubProgress = window.whisperAPI.onFileProgress((info) => {
      const t = useAppStore.getState().transfers.find((x) => x.transferId === info.transferId)
      if (!t) {
        // sender side progress (upload) not tracked yet
        return
      }
      updateTransfer(info.transferId, { received: info.received, status: 'transferring' })
    })
    const unsubComplete = window.whisperAPI.onFileComplete((info) => {
      updateTransfer(info.transferId, { status: 'complete' })
      setTimeout(() => removeTransfer(info.transferId), 4000)
    })

    window.whisperAPI.rendererReady?.()

    window.whisperAPI.getConfig().then((cfg: any) => {
      if (!cfg?.nickname) {
        setShowNickname(true)
      }
      if (cfg?.sharedPath) {
        setSharedFolder(cfg.sharedPath)
      }
      if (typeof cfg?.showNotificationPreview === 'boolean') {
        setShowNotificationPreview(cfg.showNotificationPreview)
      }
    })
    window.whisperAPI.getRooms().then((list: any) => {
      setRooms(list)
    })

    return () => {
      unsubPeers()
      unsubRooms()
      unsubJoinRejected()
      unsubRoomJoined()
      unsubMsg()
      unsubOffer()
      unsubLocal()
      unsubProgress()
      unsubComplete()
    }
  }, [setPeers, setLocalPeerId, setLocalNickname, setRooms, addMessage, addTransfer, updateTransfer, removeTransfer])

  const handleSetNickname = (name: string) => {
    window.whisperAPI.setNickname(name)
    setLocalNickname(name)
    setShowNickname(false)
  }
  const handleToggleNotificationPreview = (value: boolean) => {
    window.whisperAPI.setNotificationPreview(value)
    setShowNotificationPreview(value)
  }

  const handleSetSharedFolder = async () => {
    const folder = await window.whisperAPI.setSharedFolder()
    if (folder) setSharedFolder(folder)
  }

  const handleStopSharing = () => {
    window.whisperAPI.setSharedFolder(null).then(() => {
      setSharedFolder(null)
    })
  }

  const handleRequestJoinRoom = (roomId: string, name: string, type: 'public' | 'private') => {
    if (type === 'public') {
      window.whisperAPI.joinRoom(roomId, undefined, name, type)
    } else {
      setPendingJoinRoom({ roomId, name, type })
      setShowJoinModal(true)
    }
  }

  const handleSendFileAttachment = async () => {
    if (!activeRoomId) return
    if (!sharedFolder) {
      alert('파일 첨부를 위한 공유 폴터 설정이 필요합니다.')
      return
    }
    const res: any = await window.whisperAPI.sendFileAttachment(activeRoomId)
    if (res?.error) {
      alert(res.error)
    }
  }

  const handlePasteImage = async (file: File) => {
    if (!activeRoomId) return
    if (!sharedFolder) {
      alert('파일 첨부를 위한 공유 폴터 설정이 필요합니다.')
      return
    }
    if (!file.type.startsWith('image/')) return

    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const dataBase64 = btoa(binary)

    const res: any = await window.whisperAPI.sendFileAttachmentFromData(activeRoomId, {
      mimeType: file.type,
      dataBase64,
    })
    if (res?.error) {
      alert(res.error)
    }
  }

  const handleDownloadAttachment = async (msg: ChatMessage) => {
    if (!msg.attachment) return
    const senderPeer = peers.find((p) => p.peerId === msg.attachment!.senderId)
    if (!senderPeer) {
      alert('발신자를 찾을 수 없습니다.')
      return
    }
    const result: any = await window.whisperAPI.downloadAttachment(
      msg.roomId,
      msg.attachment.messageId,
      msg.attachment.fileName,
      senderPeer.ip,
      senderPeer.discoveryPort,
      senderPeer.peerId
    )
    if (result?.error) {
      alert(result.error)
      return
    }
    if (result?.localPath) {
      updateMessageAttachment(msg.roomId, msg.attachment.messageId, {
        localPath: result.localPath,
        dataUrl: result.dataUrl,
      })
    }
  }

  const handleJoinRoom = (roomId: string, password?: string) => {
    const name = pendingJoinRoom?.name
    const type = pendingJoinRoom?.type
    window.whisperAPI.joinRoom(roomId, password, name, type)
  }

  const handleBrowsePeerFiles = (peer: Peer) => {
    setBrowsePeer(peer)
  }

  const handleRequestLeaveRoom = (roomId: string) => {
    const room = rooms.find((r) => r.roomId === roomId)
    if (!room) return
    const members = Array.isArray(room.members) ? room.members : []
    const isLastMember = members.length <= 1 && members.includes(localPeerId)
    setLeaveTargetRoom({ roomId, name: room.name, isLastMember })
  }

  const handleConfirmLeaveRoom = async () => {
    if (!leaveTargetRoom) return
    const { roomId } = leaveTargetRoom
    const result: { ok?: boolean; error?: string } = await window.whisperAPI.leaveRoom(roomId)
    setLeaveTargetRoom(null)
    if (!result?.ok) {
      setAlertMessage('대화방을 나갈 수 없습니다.')
    }
  }

  // Update dock/taskbar badge when unread counts change
  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((sum, c) => sum + c, 0)
    window.whisperAPI.setBadgeCount(totalUnread)

    // Generate overlay icon for Windows (canvas-based badge)
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')!
    if (totalUnread > 0) {
      ctx.beginPath()
      ctx.arc(24, 8, 8, 0, 2 * Math.PI)
      ctx.fillStyle = '#EF4444'
      ctx.fill()
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const text = totalUnread > 99 ? '99+' : String(totalUnread)
      ctx.fillText(text, 24, 8)
      window.whisperAPI.setBadgeOverlay(canvas.toDataURL('image/png'))
    } else {
      window.whisperAPI.setBadgeOverlay(null)
    }
  }, [unreadCounts])

  const activeRoom = rooms.find((r) => r.roomId === activeRoomId)

  return (
    <div className="flex h-screen w-screen bg-gray-900 text-gray-100">
      <Sidebar
        peers={peers}
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelectRoom={(id) => {
          setActiveRoom(id)
          clearUnread(id)
        }}
        onCreateRoom={() => setShowCreate(true)}
        onManualConnect={() => setShowManual(true)}
        onEditNickname={() => setShowNickname(true)}
        onSetSharedFolder={handleSetSharedFolder}
        onStopSharing={handleStopSharing}
        onRequestJoinRoom={handleRequestJoinRoom}
        onBrowsePeerFiles={handleBrowsePeerFiles}
        onRefreshPeers={() => window.whisperAPI.refreshPeers()}
        nickname={localNickname}
        sharedFolder={sharedFolder}
        unreadCounts={unreadCounts}
      />
      <main className="flex-1 flex flex-col relative">
        {activeRoom ? (
          <ChatView
            room={activeRoom}
            peers={peers}
            onSendFileAttachment={handleSendFileAttachment}
            onPasteImage={handlePasteImage}
            onDownloadAttachment={handleDownloadAttachment}
            onLeaveRoom={handleRequestLeaveRoom}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Whisper Net</h2>
              <p>왼쪽에서 대화방을 선택하거나 새로 만드세요.</p>
              <p className="text-sm mt-2 text-gray-600">네트워크 피어 {peers.length}명 발견됨</p>
              {peers.length === 0 && (
                <p className="text-xs mt-1 text-gray-700">피어 탐색 중…</p>
              )}
            </div>
          </div>
        )}

        {/* File transfer progress toast */}
        {transfers.length > 0 && (
          <div className="absolute bottom-4 right-4 space-y-2 w-72">
            {transfers.map((t) => {
              const pct = t.total > 0 ? Math.round((t.received / t.total) * 100) : 0
              return (
                <div key={t.transferId} className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium truncate">{t.fileName}</span>
                    <span className="text-[10px] text-gray-500">{t.direction === 'upload' ? '↑' : '↓'}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${t.status === 'complete' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-gray-400">{pct}%</span>
                    {t.status === 'transferring' && (
                      <button
                        onClick={() => {
                          window.whisperAPI.cancelTransfer(t.transferId)
                          removeTransfer(t.transferId)
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        취소
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {showNickname && (
        <NicknameModal
          initial={localNickname}
          showNotificationPreview={showNotificationPreview}
          onSave={handleSetNickname}
          onToggleNotificationPreview={handleToggleNotificationPreview}
        />
      )}
      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreated={(room) => {
            if (room?.error) {
              setAlertMessage(room.error)
              return
            }
            addRoom(room)
            setActiveRoom(room.roomId)
            setShowCreate(false)
          }}
        />
      )}
      {showManual && (
        <ManualConnectModal
          onClose={() => setShowManual(false)}
          onConnect={(ip, port) => {
            window.whisperAPI.connectPeer(ip, port)
          }}
        />
      )}
      {browsePeer && (
        <SharedFileBrowser
          peerName={browsePeer.nickname}
          ip={browsePeer.ip}
          discoveryPort={browsePeer.discoveryPort}
          onClose={() => setBrowsePeer(null)}
        />
      )}
      {showJoinModal && pendingJoinRoom && (
        <JoinRoomModal
          roomName={pendingJoinRoom.name}
          roomId={pendingJoinRoom.roomId}
          roomType={pendingJoinRoom.type}
          onClose={() => { setShowJoinModal(false); setPendingJoinRoom(null) }}
          onJoin={handleJoinRoom}
        />
      )}
      {leaveTargetRoom && (
        <LeaveRoomModal
          roomName={leaveTargetRoom.name}
          isLastMember={leaveTargetRoom.isLastMember}
          onConfirm={handleConfirmLeaveRoom}
          onCancel={() => setLeaveTargetRoom(null)}
        />
      )}
      {alertMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-80 border border-gray-700 shadow-xl">
            <h3 className="text-lg font-semibold mb-3 text-white">알림</h3>
            <p className="text-sm text-gray-300 mb-5">{alertMessage}</p>
            <button
              onClick={() => setAlertMessage(null)}
              className="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded text-sm font-medium text-white transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
