import { useEffect, useState } from 'react'
import { useAppStore, Peer } from './stores/appStore'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import CreateRoomModal from './components/CreateRoomModal'
import NicknameModal from './components/NicknameModal'
import ManualConnectModal from './components/ManualConnectModal'
import SharedFileBrowser from './components/SharedFileBrowser'
import JoinRoomModal from './components/JoinRoomModal'

export default function App() {
  const {
    peers, rooms, localPeerId, localNickname, sharedFolder, transfers,
    setPeers, setLocalPeerId, setLocalNickname, setSharedFolder, setRooms,
    addRoom, addMessage, setActiveRoom, activeRoomId,
    addTransfer, updateTransfer, removeTransfer,
  } = useAppStore()

  const [showCreate, setShowCreate] = useState(false)
  const [showNickname, setShowNickname] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [browsePeer, setBrowsePeer] = useState<Peer | null>(null)
  const [pendingJoinRoom, setPendingJoinRoom] = useState<{ roomId: string; name: string; type: 'public' | 'private' } | null>(null)

  useEffect(() => {
    const unsubPeers = window.whisperAPI.onPeers((list) => setPeers(list))
    const unsubMsg = window.whisperAPI.onMessage((msg) => addMessage(msg))
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

    window.whisperAPI.getConfig().then((cfg: any) => {
      if (!cfg?.nickname) {
        setShowNickname(true)
      }
      if (cfg?.sharedPath) {
        setSharedFolder(cfg.sharedPath)
      }
    })
    window.whisperAPI.getRooms().then((list: any) => {
      setRooms(list)
    })

    return () => {
      unsubPeers()
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
      window.whisperAPI.getRooms().then((list: any) => setRooms(list))
    } else {
      setPendingJoinRoom({ roomId, name, type })
      setShowJoinModal(true)
    }
  }

  const handleJoinRoom = (roomId: string, password?: string) => {
    const name = pendingJoinRoom?.name
    const type = pendingJoinRoom?.type
    window.whisperAPI.joinRoom(roomId, password, name, type)
    window.whisperAPI.getRooms().then((list: any) => setRooms(list))
  }

  const handleBrowsePeerFiles = (peer: Peer) => {
    setBrowsePeer(peer)
  }

  const handleSendFile = async (peerId: string) => {
    const res: any = await window.whisperAPI.offerFile(peerId)
    if (res) {
      addTransfer({
        transferId: res.transferId,
        fileName: res.fileName,
        direction: 'upload',
        received: 0,
        total: res.size,
        peerId,
        status: 'transferring',
      })
    }
  }

  const activeRoom = rooms.find((r) => r.roomId === activeRoomId)

  return (
    <div className="flex h-screen w-screen bg-gray-900 text-gray-100">
      <Sidebar
        peers={peers}
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelectRoom={setActiveRoom}
        onCreateRoom={() => setShowCreate(true)}
        onManualConnect={() => setShowManual(true)}
        onEditNickname={() => setShowNickname(true)}
        onSetSharedFolder={handleSetSharedFolder}
        onStopSharing={handleStopSharing}
        onRequestJoinRoom={handleRequestJoinRoom}
        onBrowsePeerFiles={handleBrowsePeerFiles}
        nickname={localNickname}
        sharedFolder={sharedFolder}
      />
      <main className="flex-1 flex flex-col relative">
        {activeRoom ? (
          <ChatView room={activeRoom} onSendFile={handleSendFile} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Whisper Net</h2>
              <p>왼쪽에서 대화방을 선택하거나 새로 만드세요.</p>
              <p className="text-sm mt-2 text-gray-600">네트워크 피어 {peers.length}명 발견됨</p>
              {peers.length === 0 && (
                <p className="text-xs mt-1 text-gray-700">TCP 8080 스캔 중이거나 mDNS 폴팅 대기 중...</p>
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
          onSave={handleSetNickname}
        />
      )}
      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreated={(room) => {
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
    </div>
  )
}
