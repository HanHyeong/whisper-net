interface Props {
  roomName: string
  isLastMember: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function LeaveRoomModal({ roomName, isLastMember, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-96 border border-gray-700 shadow-xl">
        <h3 className="text-lg font-semibold mb-1 text-white">대화방 나가기</h3>
        <p className="text-sm text-gray-400 mb-4 truncate">{roomName}</p>
        <p className="text-sm text-gray-300 mb-5 leading-relaxed">
          {isLastMember ? (
            <>
              이 대화방을 나가면 <span className="text-red-400 font-medium">방이 삭제</span>되고, 이 기기의
              대화 내용이 사라집니다.
            </>
          ) : (
            <>
              이 대화방을 나갑니다. 이 기기의 대화 내용은 삭제됩니다.
              <br />
              <span className="text-gray-400 mt-2 block">
                다시 참여하려면 Discovered Rooms에서 Join할 수 있습니다.
              </span>
            </>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded text-sm bg-red-600 hover:bg-red-500 text-white font-medium"
          >
            나가기
          </button>
        </div>
      </div>
    </div>
  )
}
