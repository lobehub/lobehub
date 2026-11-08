import {
  FileSource,
  MEETING_ACTION_ITEM_STATUSES,
  MEETING_ASSIGNEE_TYPES,
  MEETING_ERROR_CODES,
  MEETING_LANGUAGES,
  MEETING_PLATFORMS,
  MEETING_REALTIME_PROVIDERS,
  MEETING_REFINE_PROVIDERS,
  MEETING_SEGMENT_SOURCES,
  MEETING_STATUSES,
  MEETING_VISIBILITIES,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { MeetingModel, MeetingStateError } from '@/database/models/meeting';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import {
  MAX_LIVE_CHUNK_BASE64_CHARS,
  MeetingMinutesService,
  MeetingTranscriptionError,
  MeetingTranscriptionService,
} from '@/server/services/meeting';
import { MeetingJobService } from '@/server/services/meeting/startJob';

import { assertFileNotInRestrictedKnowledgeBase } from './_helpers/knowledgeBaseAccess';

const meetingProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, workspaceId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, workspaceId),
      fileService: new FileService(ctx.serverDB, ctx.userId, workspaceId),
      meetingJobs: new MeetingJobService(ctx.serverDB, ctx.userId, workspaceId),
      meetingModel: new MeetingModel(ctx.serverDB, ctx.userId, workspaceId),
      minutesService: new MeetingMinutesService(ctx.serverDB, ctx.userId, workspaceId),
      transcriptionService: new MeetingTranscriptionService(ctx.serverDB, ctx.userId, workspaceId),
    },
  });
});

// Recording needs at least the member role in a workspace; viewers can only read.
const meetingWriteProcedure = meetingProcedure.use(requireWorkspaceRoleWhenScoped('member'));

// ── Schemas ──

/** Longest meeting the API accepts offsets for: 24 h in milliseconds. */
const MAX_OFFSET_MS = 24 * 60 * 60 * 1000;
/** Segments per append call; a recorder flushes far smaller batches. */
const MAX_SEGMENTS_PER_APPEND = 500;

const idInput = z.object({ id: z.string().min(1) });
/** Segments in one on-device refine result: ~8 h of speech at a few seconds per segment. */
const MAX_LOCAL_REFINE_SEGMENTS = 10_000;
const title = z.string().trim().min(1).max(255);
const offsetMs = z.number().int().min(0).max(MAX_OFFSET_MS);

const segmentInput = z
  .object({
    endMs: offsetMs,
    seq: z.number().int().min(0),
    source: z.enum(MEETING_SEGMENT_SOURCES),
    speakerLabel: z.string().trim().min(1).max(64).nullish(),
    startMs: offsetMs,
    text: z.string().max(10_000),
  })
  .refine((segment) => segment.endMs >= segment.startMs, {
    message: 'endMs must not be before startMs',
    path: ['endMs'],
  });

const localRefineSegment = z
  .object({
    endMs: offsetMs,
    speakerLabel: z.string().trim().min(1).max(64).nullish(),
    startMs: offsetMs,
    text: z.string().max(10_000),
  })
  .refine((segment) => segment.endMs >= segment.startMs, {
    message: 'endMs must not be before startMs',
    path: ['endMs'],
  });

const segmentIds = z.array(z.string()).max(200);

const assigneeRef = z.object({ id: z.string().min(1), type: z.enum(MEETING_ASSIGNEE_TYPES) });
/** `YYYY-MM-DD`, the only deadline format minutes store. */
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const minutesInput = z.object({
  actionItems: z
    .array(
      z.object({
        assignee: assigneeRef.extend({ name: z.string().max(255) }).optional(),
        assigneeHint: z.string().max(255).optional(),
        dueDate: z.string().max(64).optional(),
        id: z.string().min(1).max(64),
        segmentIds,
        speakerLabel: z.string().max(64).optional(),
        startMs: offsetMs.optional(),
        status: z.enum(MEETING_ACTION_ITEM_STATUSES),
        taskId: z.string().max(64).optional(),
        taskIdentifier: z.string().max(64).optional(),
        text: z.string().min(1).max(2000),
      }),
    )
    .max(200)
    .optional(),
  chapters: z
    .array(
      z.object({
        endMs: offsetMs,
        segmentIds,
        startMs: offsetMs,
        title: z.string().min(1).max(255),
      }),
    )
    .max(200)
    .optional(),
  decisions: z
    .array(z.object({ segmentIds, text: z.string().min(1).max(2000) }))
    .max(200)
    .optional(),
  documentId: z.string().nullish(),
  keywords: z.array(z.string().min(1).max(64)).max(50).optional(),
  model: z.string().max(255).nullish(),
  summary: z.string().max(20_000).nullish(),
});

/** HTTP-ish class of each transcription failure; the code itself travels as the message. */
const TRANSCRIPTION_ERROR_STATUS = {
  audio_missing: 'BAD_REQUEST',
  audio_unsupported: 'BAD_REQUEST',
  provider_not_configured: 'PRECONDITION_FAILED',
  provider_unavailable: 'SERVICE_UNAVAILABLE',
  quota_exceeded: 'TOO_MANY_REQUESTS',
  summarization_failed: 'INTERNAL_SERVER_ERROR',
  transcript_empty: 'BAD_REQUEST',
  transcription_failed: 'INTERNAL_SERVER_ERROR',
} as const;

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Meeting not found' });

/** Recordings browsers emit (`audio/webm`, `audio/mp4`, …); some label WebM audio as video. */
const isAudioFileType = (fileType: string) =>
  fileType.startsWith('audio/') || fileType === 'video/webm';

// A declaration (not an arrow const) so `fail(...)` narrows control flow as `never`.
function fail(error: unknown, operation: string): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof MeetingStateError) {
    throw new TRPCError({ cause: error, code: 'CONFLICT', message: error.message });
  }

  console.error(`[meeting:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation} meeting`,
  });
}

/**
 * Recorded meetings: lifecycle, transcript segments, audio location and
 * minutes.
 *
 * Access follows `MeetingModel`: reads see personal meetings of the caller,
 * or workspace meetings that are public or the caller's own private ones;
 * every write is limited to the meeting's creator and, in a workspace, to the
 * member role. Missing and forbidden meetings both read as NOT_FOUND.
 */
export const meetingRouter = router({
  /**
   * Insert or replace transcript segments (keyed by `source` + `seq`, so
   * retries are idempotent). Speakers are created from `speakerLabel`.
   */
  appendSegments: meetingWriteProcedure
    .input(
      z.object({
        meetingId: z.string().min(1),
        segments: z.array(segmentInput).max(MAX_SEGMENTS_PER_APPEND),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.meetingModel.appendSegments(input.meetingId, input.segments);
        if (!data) throw notFound();
        return { data, message: 'Segments saved', success: true };
      } catch (error) {
        fail(error, 'append segments to');
      }
    }),

  /**
   * Record where the audio lives: an uploaded file (`source: 'meeting'`,
   * uploaded through the regular file upload flow) or, on desktop local mode,
   * a path that never leaves the device.
   */
  attachAudio: meetingWriteProcedure
    .input(
      z.union([
        z.object({ audioFileId: z.string().min(1), id: z.string().min(1) }),
        z.object({ id: z.string().min(1), localAudioPath: z.string().min(1).max(4096) }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...location } = input;

        if ('audioFileId' in location) {
          const file = await ctx.fileModel.findById(location.audioFileId);
          if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'Audio file not found' });
          if (!isAudioFileType(file.fileType)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'File is not an audio recording' });
          }
          // `findById` only checks file/workspace visibility: a file parked in a
          // restricted knowledge base stays readable as a file row, so knowing its
          // id must not be enough to turn it into a meeting recording.
          await assertFileNotInRestrictedKnowledgeBase(ctx, location.audioFileId);
        }

        const previous = await ctx.meetingModel.findById(id);

        const data = await ctx.meetingModel.attachAudio(id, location);
        if (!data) throw notFound();

        // The replaced upload is no longer reachable: meeting-source files stay out
        // of the resource library and `delete` only reclaims the attached one. Best
        // effort, like `delete` — the meeting keeps its new audio either way.
        if (previous?.audioFileId && previous.audioFileId !== data.audioFileId) {
          await ctx.fileService
            .removeUnreferencedFile(previous.audioFileId, FileSource.Meeting)
            .catch((error) => console.error('[meeting:attachAudio] audio cleanup failed', error));
        }

        return { data, message: 'Audio attached', success: true };
      } catch (error) {
        fail(error, 'attach audio to');
      }
    }),

  /** Start a meeting; it begins in `recording`. */
  create: meetingWriteProcedure
    .input(
      z.object({
        language: z.enum(MEETING_LANGUAGES).optional(),
        platform: z.enum(MEETING_PLATFORMS),
        realtimeProvider: z.enum(MEETING_REALTIME_PROVIDERS),
        refineProvider: z.enum(MEETING_REFINE_PROVIDERS),
        startedAt: z.coerce.date().optional(),
        title,
        visibility: z.enum(MEETING_VISIBILITIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.meetingModel.create(input);
        return { data, message: 'Meeting created', success: true };
      } catch (error) {
        fail(error, 'create');
      }
    }),

  /**
   * The refine pass finished: `transcribing` → `summarizing`, so `detail`
   * serves the refined transcript instead of the realtime draft.
   */
  completeRefinement: meetingWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.meetingModel.completeRefinement(input.id);
      if (!data) throw notFound();
      return { data, message: 'Refinement completed', success: true };
    } catch (error) {
      fail(error, 'complete the refinement of');
    }
  }),

  /**
   * Start transcribing the stored recording end to end with speakers and
   * timestamps, replacing any earlier refined transcript, then writing the
   * minutes. Also the retry after `failed`. Runs as a background job, so this
   * returns at once with the meeting in `transcribing`; follow its status with
   * `detail`. It ends `ready`, or `failed` with `error.code` naming the fix
   * (`provider_not_configured`, `quota_exceeded`, …). Starting a job that is
   * already running returns that job.
   */
  refine: meetingWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const job = await ctx.meetingJobs.startRefine(input.id);
      if (!job) throw notFound();
      return { data: job.meeting, message: 'Refine started', success: true, taskId: job.taskId };
    } catch (error) {
      fail(error, 'refine');
    }
  }),

  /**
   * Desktop local mode: the device that holds the recording reports its own
   * refine pass — `start` (meeting → `transcribing`), `complete` with the
   * diarized transcript (then the minutes are written in the background, as
   * after `refine`), or `fail`. Only text reaches the server; the audio stays
   * on the device.
   */
  refineLocal: meetingWriteProcedure
    .input(
      z.discriminatedUnion('stage', [
        z.object({ id: z.string().min(1), stage: z.literal('start') }),
        z.object({
          id: z.string().min(1),
          segments: z.array(localRefineSegment).max(MAX_LOCAL_REFINE_SEGMENTS),
          stage: z.literal('complete'),
        }),
        z.object({
          code: z.enum(MEETING_ERROR_CODES),
          id: z.string().min(1),
          message: z.string().max(2000).optional(),
          stage: z.literal('fail'),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const service = ctx.transcriptionService;
        if (input.stage === 'complete') {
          if (!(await service.completeLocalRefine(input.id, input.segments))) throw notFound();
          const job = await ctx.meetingJobs.startMinutes(input.id);
          if (!job) throw notFound();
          return { data: job.meeting, message: 'Local refine saved', success: true };
        }

        const data =
          input.stage === 'start'
            ? await service.startLocalRefine(input.id)
            : await service.failLocalRefine(input.id, {
                code: input.code,
                message: input.message,
              });
        if (!data) throw notFound();
        return { data, message: 'Local refine saved', success: true };
      } catch (error) {
        fail(error, 'refine');
      }
    }),

  /**
   * Draft one slice of a live recording where no realtime gateway is deployed
   * and store it as realtime segment `seq` (retries replace, never duplicate).
   * Errors carry the meeting error code as their message.
   */
  transcribeLive: meetingWriteProcedure
    .input(
      z
        .object({
          audioBase64: z.string().min(1).max(MAX_LIVE_CHUNK_BASE64_CHARS),
          endMs: offsetMs,
          meetingId: z.string().min(1),
          seq: z.number().int().min(0),
          startMs: offsetMs,
        })
        .refine((value) => value.endMs >= value.startMs, {
          message: 'endMs must not be before startMs',
          path: ['endMs'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.transcriptionService.transcribeLiveChunk(input);
        if (!data) throw notFound();
        return { data, success: true };
      } catch (error) {
        if (error instanceof MeetingTranscriptionError) {
          throw new TRPCError({
            cause: error,
            code: TRANSCRIPTION_ERROR_STATUS[error.code],
            message: error.code,
          });
        }
        fail(error, 'transcribe');
      }
    }),

  /** Members and agents an action item can be assigned to, for the confirmation list. */
  assigneeCandidates: meetingProcedure.query(async ({ ctx }) => {
    try {
      const candidates = await ctx.minutesService.listAssigneeCandidates();
      return {
        data: candidates.map(({ avatar, id, name, type }) => ({ avatar, id, name, type })),
        success: true,
      };
    } catch (error) {
      fail(error, 'list assignees of');
    }
  }),

  /**
   * Turn confirmed action items into LobeHub tasks with the text, assignee
   * and deadline the user confirmed. Created tasks are linked back into the
   * minutes; items that failed are reported and stay suggested for a retry.
   */
  createTasks: meetingWriteProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              assignee: assigneeRef.nullish(),
              dueDate: dueDate.nullish(),
              id: z.string().min(1).max(64),
              text: z.string().trim().min(1).max(2000),
            }),
          )
          .min(1)
          .max(100),
        meetingId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.minutesService.createTasks(input.meetingId, input.items);
        if (!data) throw notFound();
        return { data, message: 'Tasks created', success: true };
      } catch (error) {
        fail(error, 'create tasks from');
      }
    }),

  /**
   * (Re)generate the minutes from the final transcript in a background job.
   * Returns at once with the meeting in `summarizing`; it ends `ready`, with
   * `error.stage = 'minutes'` when generation failed.
   */
  generateMinutes: meetingWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const job = await ctx.meetingJobs.startMinutes(input.id);
      if (!job) throw notFound();
      return { data: job.meeting, message: 'Minutes started', success: true, taskId: job.taskId };
    } catch (error) {
      fail(error, 'generate minutes of');
    }
  }),

  /** Delete the meeting, its transcript and minutes, and reclaim its uploaded audio. */
  delete: meetingWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.meetingModel.delete(input.id);
      if (!data) throw notFound();

      if (data.audioFileId) {
        // Best effort: the meeting is gone either way, and an orphaned upload is
        // still the user's file to remove from storage later.
        await ctx.fileService
          .removeUnreferencedFile(data.audioFileId, FileSource.Meeting)
          .catch((error) => console.error('[meeting:delete] audio cleanup failed', error));
      }

      return { data, message: 'Meeting deleted', success: true };
    } catch (error) {
      fail(error, 'delete');
    }
  }),

  /**
   * One meeting with speakers, one transcript (refined once available, else
   * the realtime draft; `source` forces one), minutes and a playable audio URL.
   */
  detail: meetingProcedure
    .input(idInput.extend({ source: z.enum(MEETING_SEGMENT_SOURCES).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        const meeting = await ctx.meetingModel.getDetail(input.id, { source: input.source });
        if (!meeting) throw notFound();

        const expired = await ctx.meetingJobs.expireStaleJob(meeting);
        if (expired) Object.assign(meeting, { error: expired.error, status: expired.status });

        // The upload stays private to the creator, but the recording belongs to
        // the meeting: a member who can read a public meeting may play it. The
        // fallback only accepts this creator's `meeting`-source uploads, so it
        // cannot widen access to arbitrary attachments.
        const file = meeting.audioFileId
          ? ((await ctx.fileModel.findById(meeting.audioFileId)) ??
            (await ctx.fileModel.findMeetingAudio(meeting.audioFileId, meeting.userId)))
          : undefined;
        if (file) {
          // Access can change after the audio was attached: gate playback on the
          // same knowledge-base rule the file endpoints use.
          await assertFileNotInRestrictedKnowledgeBase(ctx, file.id);
        }
        const audio = file
          ? {
              fileType: file.fileType,
              id: file.id,
              name: file.name,
              size: file.size,
              url: await ctx.fileService.getFullFileUrl(file.url),
            }
          : null;

        return { data: { ...meeting, audio }, success: true };
      } catch (error) {
        fail(error, 'read');
      }
    }),

  /** Stop recording; the meeting moves to `uploading` or, with audio stored, `transcribing`. */
  finish: meetingWriteProcedure
    .input(
      idInput.extend({
        durationMs: offsetMs.optional(),
        endedAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...rest } = input;
        const data = await ctx.meetingModel.finish(id, rest);
        if (!data) throw notFound();
        return { data, message: 'Meeting finished', success: true };
      } catch (error) {
        fail(error, 'finish');
      }
    }),

  /** Meetings visible to the caller, newest first. */
  list: meetingProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
          status: z.enum(MEETING_STATUSES).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const data = await ctx.meetingModel.list(input);
        return { data, success: true };
      } catch (error) {
        fail(error, 'list');
      }
    }),

  pause: meetingWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.meetingModel.pause(input.id);
      if (!data) throw notFound();
      return { data, message: 'Meeting paused', success: true };
    } catch (error) {
      fail(error, 'pause');
    }
  }),

  rename: meetingWriteProcedure
    .input(idInput.extend({ title }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.meetingModel.rename(input.id, input.title);
        if (!data) throw notFound();
        return { data, message: 'Meeting renamed', success: true };
      } catch (error) {
        fail(error, 'rename');
      }
    }),

  /**
   * Name a diarized speaker; `null` falls back to the speaker label. Suggested
   * to-dos owned by that speaker are assigned to the member or agent the name
   * matches.
   */
  renameSpeaker: meetingWriteProcedure
    .input(
      z.object({
        displayName: z.string().trim().min(1).max(255).nullable(),
        meetingId: z.string().min(1),
        speakerId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.meetingModel.renameSpeaker(
          input.meetingId,
          input.speakerId,
          input.displayName,
        );
        if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Speaker not found' });

        // Naming a speaker is how a to-do the minutes gave to "S3" reaches a member or agent.
        await ctx.minutesService
          .assignSpeakerItems(input.meetingId, data.label, input.displayName)
          .catch((error) => console.error('[meeting:renameSpeaker] assignees not updated', error));

        return { data, message: 'Speaker renamed', success: true };
      } catch (error) {
        fail(error, 'rename speaker of');
      }
    }),

  resume: meetingWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.meetingModel.resume(input.id);
      if (!data) throw notFound();
      return { data, message: 'Meeting resumed', success: true };
    } catch (error) {
      fail(error, 'resume');
    }
  }),

  /** Create or patch the meeting's minutes; omitted fields keep their stored value. */
  saveMinutes: meetingWriteProcedure
    .input(minutesInput.extend({ meetingId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { meetingId, ...minutes } = input;

        if (minutes.documentId && !(await ctx.documentModel.findById(minutes.documentId))) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Minutes document not found' });
        }

        const data = await ctx.meetingModel.saveMinutes(meetingId, minutes);
        if (!data) throw notFound();
        return { data, message: 'Minutes saved', success: true };
      } catch (error) {
        fail(error, 'save minutes of');
      }
    }),
});

export type MeetingRouter = typeof meetingRouter;
