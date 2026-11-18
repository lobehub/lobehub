// Members editing in a page's room share the page's edit lock, so a member
// editing outside the room is locked out; room members never lock each other.
export const ROOM_LOCK_OWNER_PREFIX = 'room:';

export const isRoomLockOwner = (ownerId: string | null | undefined) =>
  !!ownerId?.startsWith(ROOM_LOCK_OWNER_PREFIX);
