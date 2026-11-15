import { defineReplica } from '@/libs/replica';
import type { MeetingDetail, MeetingListItem } from '@/services/meeting';

/** The meetings page shows one list, newest first; this is its only entry key. */
export const MEETING_LIST_KEY = 'all';

export const meetingListResource = defineReplica<string, MeetingListItem[]>({
  key: (key) => key,
  name: 'meetingList',
  storage: 'indexedDB',
  version: 1,
});

export const meetingDetailResource = defineReplica<string, MeetingDetail>({
  key: (meetingId) => meetingId,
  name: 'meetingDetail',
  storage: 'indexedDB',
  version: 1,
});
