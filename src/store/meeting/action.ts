import { MEETING_LIVE_STATUSES, type MeetingStatus } from '@lobechat/types';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { type MeetingDetail, type MeetingListItem, meetingService } from '@/services/meeting';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  initialRecorderState,
  initialState,
  type MeetingOverlayState,
  type MeetingRecorderState,
  type MeetingState,
  type MicrophoneDevice,
  type MicrophonePermission,
} from './initialState';
import { MEETING_LIST_KEY, meetingDetailResource, meetingListResource } from './projection';
import { useMeetingStore } from './store';

const n = setNamespace('meeting');

type Setter = StoreSetter<MeetingState>;

/** The list page reads one window; meetings are long-lived but few per user. */
const MEETING_LIST_LIMIT = 100;

/**
 * Server-side stages a detail keeps re-reading through: the transcript and the
 * minutes land while the page is open, and nothing else tells it they did.
 */
const PROCESSING_STATUSES = new Set<MeetingStatus>([
  ...MEETING_LIVE_STATUSES,
  'uploading',
  'transcribing',
  'summarizing',
]);
const PROCESSING_POLL_INTERVAL = 4000;

export const isMeetingProcessing = (status: MeetingStatus) => PROCESSING_STATUSES.has(status);

export class MeetingActionImpl {
  readonly #get: () => MeetingState;
  readonly #set: Setter;
  readonly #detail;
  readonly #list;

  constructor(set: Setter, get: () => MeetingState) {
    this.#set = set;
    this.#get = get;

    this.#list = createReplicaSlice(meetingListResource, {
      actionPrefix: 'meetingList',
      fetcher: () => meetingService.list({ limit: MEETING_LIST_LIMIT }),
      get,
      set,
      stateKey: 'meetingListReplica',
      view: recordLens<MeetingState, MeetingListItem[]>('meetingListMap'),
    });

    this.#detail = createReplicaSlice(meetingDetailResource, {
      actionPrefix: 'meetingDetail',
      fetcher: (meetingId) => meetingService.detail(meetingId),
      get,
      set,
      stateKey: 'meetingDetailReplica',
      view: recordLens<MeetingState, MeetingDetail>('meetingDetailMap'),
    });
  }

  // ── Server data ──

  useFetchMeetings = (): ReplicaSyncResult =>
    this.#list.useSync(MEETING_LIST_KEY, {
      // A row in a processing stage moves on by itself; keep the badge honest.
      refreshInterval: (latest?: MeetingListItem[]) =>
        latest?.some((item) => isMeetingProcessing(item.status)) ? PROCESSING_POLL_INTERVAL : 0,
    });

  useFetchMeetingDetail = (meetingId?: string): ReplicaSyncResult =>
    this.#detail.useSync(meetingId || null, {
      refreshInterval: (latest?: MeetingDetail) =>
        latest && isMeetingProcessing(latest.status) ? PROCESSING_POLL_INTERVAL : 0,
    });

  refreshMeetings = (): Promise<unknown> => this.#list.fetch(MEETING_LIST_KEY, { fresh: true });

  refreshMeetingDetail = (meetingId: string): Promise<unknown> =>
    this.#detail.fetch(meetingId, { fresh: true });

  // ── Floating recorder ──

  openRecorder = (): void => {
    this.#set(
      { overlay: { ...this.#get().overlay, minimized: false, open: true } },
      false,
      n('openRecorder'),
    );
  };

  /** Only an idle or finished recorder can be dismissed; a live one minimizes instead. */
  closeRecorder = (): void => {
    const { phase } = this.#get().recorder;
    if (phase !== 'idle' && phase !== 'done') return;

    this.#set(
      { overlay: { ...this.#get().overlay, open: false }, recorder: initialRecorderState },
      false,
      n('closeRecorder'),
    );
  };

  setOverlay = (overlay: Partial<MeetingOverlayState>): void => {
    this.#set({ overlay: { ...this.#get().overlay, ...overlay } }, false, n('setOverlay'));
  };

  patchRecorder = (recorder: Partial<MeetingRecorderState>, action = 'patchRecorder'): void => {
    this.#set({ recorder: { ...this.#get().recorder, ...recorder } }, false, n(action));
  };

  resetRecorder = (): void => {
    this.#set({ recorder: initialRecorderState }, false, n('resetRecorder'));
  };

  setDevices = (devices: MicrophoneDevice[]): void => {
    const { selectedDeviceId } = this.#get();
    // A device that was unplugged falls back to the system default.
    const stillThere = devices.some((device) => device.deviceId === selectedDeviceId);
    this.#set(
      { devices, selectedDeviceId: stillThere ? selectedDeviceId : undefined },
      false,
      n('setDevices'),
    );
  };

  selectDevice = (deviceId?: string): void => {
    this.#set({ selectedDeviceId: deviceId }, false, n('selectDevice'));
  };

  setPermission = (permission: MicrophonePermission): void => {
    this.#set({ permission }, false, n('setPermission'));
  };

  reset = (): void => {
    // A recording in progress belongs to the recorder, not to the data context:
    // keep it (and its overlay) so a background refresh never drops audio.
    const { overlay, recorder, selectedDeviceId } = this.#get();
    this.#set({ ...initialState, overlay, recorder, selectedDeviceId }, false, n('reset'));
  };
}

const { getState, setState } = useMeetingStore;

export const meetingActions = new MeetingActionImpl(setState, getState);
