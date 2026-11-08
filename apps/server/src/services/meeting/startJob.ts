import type { MeetingJobMetadata } from '@lobechat/types';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { MeetingModel } from '@/database/models/meeting';
import type { MeetingItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createAsyncCaller } from '@/server/routers/async';
import { after } from '@/server/utils/scheduleAfterResponse';

import { failMeetingStage } from './runJob';

/**
 * A job older than this has lost its worker: no host keeps a request open that
 * long. It stays above the longest function duration, so a slow run of a long
 * recording is never declared dead while it is still working.
 */
export const MEETING_JOB_STALE_MS = 15 * 60_000;

const JOB_TYPES = [AsyncTaskType.MeetingMinutes, AsyncTaskType.MeetingRefine];

const TIMEOUT_MESSAGE = 'The background job stopped responding';

/**
 * Starts the post-recording work of a meeting as a background job and returns
 * right away. The meeting's status is what clients follow. Kept apart from
 * `runJob.ts` so the async router can import that without importing itself back.
 */
export class MeetingJobService {
  private readonly asyncTaskModel: AsyncTaskModel;
  private readonly meetingModel: MeetingModel;

  constructor(
    db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
    this.meetingModel = new MeetingModel(db, userId, workspaceId);
  }

  /** Throws `MeetingStateError` while the meeting cannot be refined; `undefined` when not the caller's. */
  startRefine(meetingId: string) {
    return this.start(AsyncTaskType.MeetingRefine, meetingId, () =>
      this.meetingModel.startRefine(meetingId),
    );
  }

  /** Throws `MeetingStateError` while the transcript is not final; `undefined` when not the caller's. */
  startMinutes(meetingId: string) {
    return this.start(AsyncTaskType.MeetingMinutes, meetingId, () =>
      this.meetingModel.startMinutes(meetingId),
    );
  }

  /**
   * A worker killed by its host cannot report anything, so a reader polling the
   * meeting closes the job once it is stale. Returns the meeting when it changed.
   */
  async expireStaleJob(meeting: Pick<MeetingItem, 'id' | 'status' | 'userId'>) {
    if (meeting.userId !== this.userId) return undefined;
    if (meeting.status !== 'transcribing' && meeting.status !== 'summarizing') return undefined;

    const task = await this.findActiveJob(meeting.id);
    if (!task || !this.isStale(task)) return undefined;

    await this.markTimedOut(task.id);
    return failMeetingStage(this.meetingModel, meeting, TIMEOUT_MESSAGE);
  }

  private findActiveJob(meetingId: string) {
    return this.asyncTaskModel.findOldestActiveByMetadata(JOB_TYPES, {
      meetingId,
    } satisfies MeetingJobMetadata);
  }

  private isStale(task: { createdAt: Date }) {
    return Date.now() - task.createdAt.getTime() > MEETING_JOB_STALE_MS;
  }

  private markTimedOut(taskId: string) {
    return this.asyncTaskModel.update(taskId, {
      error: new AsyncTaskError(AsyncTaskErrorType.Timeout, TIMEOUT_MESSAGE),
      status: AsyncTaskStatus.Error,
    });
  }

  private async start(
    type: AsyncTaskType,
    meetingId: string,
    begin: () => Promise<MeetingItem | undefined>,
  ) {
    // First, so a caller who may not manage the meeting learns nothing about its jobs.
    const meeting = await begin();
    if (!meeting) return undefined;

    const running = await this.findActiveJob(meetingId);
    if (running) {
      if (!this.isStale(running)) return { meeting, taskId: running.id };
      await this.markTimedOut(running.id);
    }

    const taskId = await this.asyncTaskModel.create({
      metadata: { meetingId } satisfies MeetingJobMetadata,
      status: AsyncTaskStatus.Pending,
      type,
    });

    // Two concurrent starts both get here; the earliest job is the one that runs.
    const earliest = await this.findActiveJob(meetingId);
    if (earliest && earliest.id !== taskId) {
      await this.asyncTaskModel.delete(taskId);
      return { meeting, taskId: earliest.id };
    }

    this.dispatch(type, meetingId, taskId);
    return { meeting, taskId };
  }

  private dispatch(type: AsyncTaskType, meetingId: string, taskId: string) {
    const input = { meetingId, taskId, workspaceId: this.workspaceId };

    // Kept alive past the response, so a refused hand-off can still be reported.
    after(async () => {
      try {
        const caller = await createAsyncCaller({ userId: this.userId });
        await (type === AsyncTaskType.MeetingRefine
          ? caller.meeting.runRefine(input)
          : caller.meeting.runMinutes(input));
      } catch (error) {
        console.error('[meeting:job] hand-off of %s failed: %O', taskId, error);
        // A dropped response is not a failed job: the router may have claimed it.
        // That job closes itself, or expires if it never arrived.
        if (!isAnsweredHandOff(error)) return;
        await this.failUnclaimed(meetingId, taskId);
      }
    });
  }

  private async failUnclaimed(meetingId: string, taskId: string) {
    const task = await this.asyncTaskModel.findById(taskId);
    if (task?.status !== AsyncTaskStatus.Pending) return;

    const message = 'The background job could not be started';
    await this.asyncTaskModel.update(taskId, {
      error: new AsyncTaskError(AsyncTaskErrorType.TaskTriggerError, message),
      status: AsyncTaskStatus.Error,
    });

    const meeting = await this.meetingModel.findById(meetingId);
    if (meeting) await failMeetingStage(this.meetingModel, meeting, message);
  }
}

/**
 * The host sent an answer, so the request is over. A tRPC answer carries its
 * response; a host page that is not tRPC JSON (such as Vercel's 508) fails to
 * parse, which a dropped connection never does.
 */
const isAnsweredHandOff = (error: unknown) =>
  !(error instanceof TRPCClientError) ||
  error.meta?.response !== undefined ||
  error.cause instanceof SyntaxError;
