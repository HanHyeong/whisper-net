import { Peer, Room } from '../stores/appStore'
import { useEffect, useState } from 'react'

interface Props {
  peers: Peer[]
  rooms: Room[]
  activeRoomId: string | null
  onSelectRoom: (id: string) => void
  onCreateRoom: () => void
  onRequestJoinRoom: (roomId: string, name: string, type: 'public' | 'private') => void
  onManualConnect: () => void
  onEditNickname: () => void
  onSetSharedFolder: () => void
  onStopSharing: () => void
  onBrowsePeerFiles: (peer: Peer) => void
  onRefreshPeers: () => void
  nickname: string
  sharedFolder: string | null
  unreadCounts: Record<string, number>
}

export default function Sidebar({ peers, rooms, activeRoomId, onSelectRoom, onCreateRoom, onRequestJoinRoom, onManualConnect, onEditNickname, onSetSharedFolder, onStopSharing, onBrowsePeerFiles, onRefreshPeers, nickname, sharedFolder, unreadCounts }: Props) {
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.whisperAPI.getVersion().then((v: string) => setVersion(v))
  }, [])

  // Derive discovered rooms from peers (both public and private)
  const discoveredRooms = peers
    .flatMap((p) => (p.rooms || []))
    .filter((r, i, arr) => arr.findIndex((x) => x.roomId === r.roomId) === i)

  const myRoomIds = new Set(rooms.map((r) => r.roomId))
  const newDiscovered = discoveredRooms.filter((r: any) => !myRoomIds.has(r.roomId))

  return (
    <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg text-emerald-400">Whisper Net</h1>
            <p className="text-xs text-gray-500">P2P LAN Messenger <span className="text-[10px] text-gray-600 ml-1">v{version}</span></p>
          </div>
          <button onClick={onEditNickname} className="text-[10px] text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-1" title="nick change">
            {nickname || 'User'}
          </button>
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase">Network Peers</span>
          <div className="flex gap-1">
            <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full">{peers.length}</span>
            <button onClick={onRefreshPeers} className="text-sm bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" title="refresh peers">🔄</button>
            <button onClick={onManualConnect} className="text-sm bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded" title="manual connect">+</button>
          </div>
        </div>
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {peers.map((p) => (
            <li key={p.peerId} className="text-sm text-gray-300 px-2 py-1 rounded hover:bg-gray-700 cursor-default group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {p.nickname}
                </div>
                <button
                  onClick={() => onBrowsePeerFiles(p)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] bg-gray-600 hover:bg-gray-500 px-1.5 py-0.5 rounded"
                  title="browse shared"
                >
                  📁
                </button>
              </div>
              <div className="text-[10px] text-gray-500 ml-4">{p.ip}:{p.tcpPort}</div>
            </li>
          ))}
          {peers.length === 0 && <li className="text-xs text-gray-600 px-2">No peers (scanning TCP 8080...)</li>}
        </ul>
      </div>

      <div className="flex-1 p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase">My Rooms</span>
          <button onClick={onCreateRoom} className="text-xs bg-emerald-600 hover:bg-emerald-500 px-2 py-1 rounded">+ New Room</button>
        </div>
        <ul className="space-y-1">
          {rooms.map((r) => (
            <li
              key={r.roomId}
              onClick={() => onSelectRoom(r.roomId)}
              className={'text-sm px-3 py-2 rounded cursor-pointer flex items-center justify-between ' + (activeRoomId === r.roomId ? 'bg-gray-700 text-emerald-300' : 'hover:bg-gray-700 text-gray-300')}
            >
              <span className="truncate">{r.name}</span>
              <div className="flex items-center gap-1.5">
                {(unreadCounts[r.roomId] || 0) > 0 && (
                  <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {unreadCounts[r.roomId]}
                  </span>
                )}
                <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (r.type === 'public' ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300')}>
                  {r.type === 'public' ? 'Public' : 'Private'}
                </span>
              </div>
            </li>
          ))}
          {rooms.length === 0 && <li className="text-xs text-gray-600 px-2">No rooms</li>}
        </ul>

        {newDiscovered.length > 0 && (
          <>
            <div className="flex items-center justify-between mt-4 mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase">Discovered Rooms</span>
            </div>
            <ul className="space-y-1">
              {newDiscovered.map((r: any) => (
                <li
                  key={r.roomId}
                  onClick={() => onRequestJoinRoom(r.roomId, r.name, r.type)}
                  className="text-sm px-3 py-2 rounded cursor-pointer hover:bg-gray-700 text-gray-300 flex items-center justify-between border border-dashed border-gray-600"
                >
                  <span className="truncate flex items-center gap-1">
                    {r.type === 'private' && <span>🔒</span>}
                    {r.name}
                  </span>
                  <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (r.type === 'public' ? 'bg-blue-900/50 text-blue-300' : 'bg-red-900/50 text-red-300')}>
                    {r.type === 'public' ? '+ Join' : '🔒 Join'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="p-3 border-t border-gray-700 space-y-2">
        <div className="flex items-center justify-between bg-gray-900/50 px-3 py-2 rounded">
          <div className="flex flex-col">
            <span className="text-xs text-gray-300">Shared Folder</span>
            {sharedFolder ? (
              <span className="text-[10px] text-emerald-400 truncate max-w-[140px]" title={sharedFolder}>
                {sharedFolder.split('/').pop()}
              </span>
            ) : (
              <span className="text-[10px] text-gray-500">Off</span>
            )}
          </div>
          <button
            onClick={sharedFolder ? onStopSharing : onSetSharedFolder}
            className={'relative w-11 h-6 rounded-full transition-colors ' + (sharedFolder ? 'bg-emerald-600' : 'bg-gray-600')}
            title={sharedFolder ? 'Turn off sharing' : 'Turn on sharing'}
          >
            <span
              className={'absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ' + (sharedFolder ? 'translate-x-5' : '')}
            />
          </button>
        </div>
        {sharedFolder && (
          <button
            onClick={onSetSharedFolder}
            className="w-full text-xs bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded text-left flex items-center gap-2"
          >
            <span>📁</span>
            Change Folder
          </button>
        )}
      </div>
    </aside>
  )
}
