import { Peer } from '../stores/appStore'

export interface RoomMemberDisplay {
  peerId: string
  nickname: string
  isLocal: boolean
  isOnline: boolean
}

export function buildRoomMemberList(
  memberIds: string[],
  peers: Peer[],
  localPeerId: string,
  localNickname: string
): RoomMemberDisplay[] {
  const peerMap = new Map(peers.map((p) => [p.peerId, p]))

  const members = memberIds.map((peerId) => {
    const isLocal = peerId === localPeerId
    const peer = peerMap.get(peerId)
    return {
      peerId,
      nickname: isLocal ? localNickname || '나' : peer?.nickname || '알 수 없음',
      isLocal,
      isOnline: isLocal || !!peer,
    }
  })

  return members.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1
    return a.nickname.localeCompare(b.nickname, 'ko')
  })
}
