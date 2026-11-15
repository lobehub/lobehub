import type { MeetingState } from './initialState';
import { MEETING_LIST_KEY } from './projection';

const meetingList = (s: MeetingState) => s.meetingListMap[MEETING_LIST_KEY];

const meetingDetail = (meetingId?: string) => (s: MeetingState) =>
  meetingId ? s.meetingDetailMap[meetingId] : undefined;

/** Title of a meeting from whichever copy is loaded, for route meta and breadcrumbs. */
const meetingTitle = (meetingId?: string) => (s: MeetingState) =>
  meetingId
    ? (s.meetingDetailMap[meetingId]?.title ??
      meetingList(s)?.find((item) => item.id === meetingId)?.title)
    : undefined;

/** A recording is in progress (or still being saved); the home entry reopens it. */
const isRecorderBusy = (s: MeetingState) =>
  s.recorder.phase === 'recording' ||
  s.recorder.phase === 'paused' ||
  s.recorder.phase === 'finishing' ||
  s.recorder.phase === 'requesting_permission';

export const meetingSelectors = {
  isRecorderBusy,
  meetingDetail,
  meetingList,
  meetingTitle,
};
