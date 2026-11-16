import type { MeetingError, MeetingStatus } from '@lobechat/types';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@lobechat/types';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { MeetingModel } from '@/database/models/meeting';
import type { LobeChatDatabase } from '@/database/type';

import { toMeetingErrorMessage } from './errors';
import { MeetingTranscriptionService } from './index';
import { MeetingMinutesService } from './minutes';

export interface MeetingJobInput {
  meetingId: string;
  taskId: string;
  workspaceId?: string;
}

/**
 * Close the stage a meeting is stuck in, so it does not read as running forever.
 * A meeting that moved on meanwhile has nothing left to close.
 */
export const failMeetingStage = async (
  meetingModel: MeetingModel,
  meeting: { id: string; status: MeetingStatus },
  message: string,
) => {
  try {
    if (meeting.status === 'transcribing') {
      return await meetingModel.failRefine(meeting.id, {
        code: 'transcription_failed',
        message,
        stage: 'refine',
      });
    }
    if (meeting.status === 'summarizing') {
      return await meetingModel.failMinutes(meeting.id, {
        code: 'summarization_failed',
        message,
        stage: 'minutes',
      });
    }
  } catch (error) {
    console.warn('[meeting:job] could not close stage of %s: %O', meeting.id, error);
  }

  return undefined;
};

const runJob = async (
  db: LobeChatDatabase,
  userId: string,
  { meetingId, taskId, workspaceId }: MeetingJobInput,
  work: () => Promise<{ error: MeetingError | null } | undefined>,
) => {
  const asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
  const task = await asyncTaskModel.findById(taskId);
  // Only a job still waiting to be claimed: a repeated hand-off must not pay for a second run.
  if (task?.status !== AsyncTaskStatus.Pending) return;

  await asyncTaskModel.update(taskId, { status: AsyncTaskStatus.Processing });

  const startedAt = Date.now();
  const finish = (error: AsyncTaskError | null) =>
    asyncTaskModel.update(taskId, {
      duration: Date.now() - startedAt,
      error,
      status: error ? AsyncTaskStatus.Error : AsyncTaskStatus.Success,
    });

  try {
    const meeting = await work();
    // The stage itself recorded why it failed on the meeting; the task only mirrors it.
    await finish(
      meeting?.error
        ? new AsyncTaskError(AsyncTaskErrorType.ServerError, meeting.error.code)
        : null,
    );
  } catch (error) {
    console.error('[meeting:job] %s failed: %O', taskId, error);
    const message = toMeetingErrorMessage(error) ?? 'The background job failed';
    const meetingModel = new MeetingModel(db, userId, workspaceId);
    const meeting = await meetingModel.findById(meetingId);
    if (meeting) await failMeetingStage(meetingModel, meeting, message);
    await finish(new AsyncTaskError(AsyncTaskErrorType.ServerError, message));
  }
};

export const runMeetingRefineJob = (db: LobeChatDatabase, userId: string, input: MeetingJobInput) =>
  runJob(db, userId, input, () =>
    new MeetingTranscriptionService(db, userId, input.workspaceId).refine(input.meetingId),
  );

export const runMeetingMinutesJob = (
  db: LobeChatDatabase,
  userId: string,
  input: MeetingJobInput,
) =>
  runJob(db, userId, input, () =>
    new MeetingMinutesService(db, userId, input.workspaceId).generate(input.meetingId),
  );
