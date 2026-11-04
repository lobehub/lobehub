import {
  FileSource,
  MEETING_ACTION_ITEM_STATUSES,
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

import { assertFileNotInRestrictedKnowledgeBase } from './_helpers/knowledgeBaseAccess';

const meetingProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, workspaceId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, workspaceId),
      fileService: new FileService(ctx.serverDB, ctx.userId, workspaceId),
      meetingModel: new MeetingModel(ctx.serverDB, ctx.userId, workspaceId),
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

const segmentIds = z.array(z.string()).max(200);

const minutesInput = z.object({
  actionItems: z
    .array(
      z.object({
        assigneeHint: z.string().max(255).optional(),
        dueDate: z.string().max(64).optional(),
        id: z.string().min(1).max(64),
        segmentIds,
        speakerLabel: z.string().max(64).optional(),
        status: z.enum(MEETING_ACTION_ITEM_STATUSES),
        taskId: z.string().max(64).optional(),
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

  /** Name a diarized speaker; `null` falls back to the speaker label. */
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
