import { RoomMemberDisplay } from '../utils/roomMembers'

interface Props {
  roomName: string
  members: RoomMemberDisplay[]
  onClose: () => void
}

export default function RoomMembersModal({ roomName, members, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-800 rounded-lg p-6 w-80 border border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1 text-white">참여자</h3>
        <p className="text-sm text-gray-400 mb-4 truncate">{roomName}</p>

        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {members.map((member) => (
            <li
              key={member.peerId}
              className="flex items-center justify-between bg-gray-900/60 rounded px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${member.isOnline ? 'bg-emerald-400' : 'bg-gray-500'}`}
                  title={member.isOnline ? '온라인' : '오프라인'}
                />
                <span className="truncate text-gray-100">
                  {member.nickname}
                  {member.isLocal && <span className="text-emerald-400 ml-1">(나)</span>}
                </span>
              </div>
              <span className="text-[10px] text-gray-500 shrink-0 ml-2">
                {member.isOnline ? '접속 중' : '오프라인'}
              </span>
            </li>
          ))}
          {members.length === 0 && (
            <li className="text-sm text-gray-500 text-center py-4">참여자 정보가 없습니다.</li>
          )}
        </ul>

        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
