import type {
  MeetingActionItem,
  MeetingAssignee,
  MeetingChapter,
  MeetingDecision,
} from '@lobechat/types';
import dayjs from 'dayjs';
import { z } from 'zod';

const segmentIndexes = z.array(z.number().int()).max(50);

/**
 * Service-boundary validation of the `meeting_minutes` output. It mirrors
 * `MEETING_MINUTES_JSON_SCHEMA` but is lenient where a model drifts harmlessly
 * (a missing optional string, an over-long field), and strict where a wrong
 * shape would corrupt the minutes.
 */
export const generatedMinutesSchema = z.object({
  actionItems: z
    .array(
      z.object({
        assignee: z.string().optional().default(''),
        dueDate: z.string().optional().default(''),
        segmentIndexes: segmentIndexes.optional().default([]),
        text: z.string().trim().min(1),
      }),
    )
    .max(50),
  chapters: z
    .array(
      z.object({
        endIndex: z.number().int(),
        startIndex: z.number().int(),
        title: z.string().trim().min(1),
      }),
    )
    .max(50),
  decisions: z
    .array(
      z.object({
        segmentIndexes: segmentIndexes.optional().default([]),
        text: z.string().trim().min(1),
      }),
    )
    .max(50),
  keywords: z.array(z.string()).optional().default([]),
  summary: z.string().trim().min(1),
});

export type GeneratedMinutes = z.infer<typeof generatedMinutesSchema>;

/** A transcript segment as the prompt numbered it. */
export interface MinutesTranscriptLine {
  endMs: number;
  segmentId: string;
  speakerLabel?: string;
  startMs: number;
}

export interface NormalizeMinutesOptions {
  /** Id for the `index`-th action item; unique within the stored minutes. */
  actionItemId: (index: number) => string;
  /** Resolve the owner the model named (and the speaker of the cited line) to a member or agent. */
  resolveAssignee: (hint: string | undefined, speakerLabel?: string) => MeetingAssignee | undefined;
}

export interface NormalizedMinutes {
  actionItems: MeetingActionItem[];
  chapters: MeetingChapter[];
  decisions: MeetingDecision[];
  keywords: string[];
  summary: string;
}

const MAX_TEXT = 2000;
const MAX_TITLE = 255;
const MAX_KEYWORDS = 8;

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/** A real calendar date in `YYYY-MM-DD`, or `undefined`. */
export const parseDueDate = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  const date = dayjs(trimmed);
  return date.isValid() && date.format('YYYY-MM-DD') === trimmed ? trimmed : undefined;
};

/**
 * Turn validated model output into stored minutes: cited line numbers become
 * segment ids and timestamps (out-of-range citations are dropped), chapters
 * are ordered and made non-overlapping, deadlines must be real dates, and
 * owners are resolved to members or agents.
 */
export const normalizeMinutes = (
  raw: GeneratedMinutes,
  lines: MinutesTranscriptLine[],
  options: NormalizeMinutesOptions,
): NormalizedMinutes => {
  const last = lines.length - 1;

  const cite = (indexes: number[]) =>
    [...new Set(indexes.filter((index) => index >= 0 && index <= last))].sort((a, b) => a - b);

  const chapters: MeetingChapter[] = [];
  if (last >= 0) {
    const spans = raw.chapters
      .map((chapter) => {
        const start = Math.min(Math.max(chapter.startIndex, 0), last);
        const end = Math.min(Math.max(chapter.endIndex, 0), last);
        return { end: Math.max(start, end), start: Math.min(start, end), title: chapter.title };
      })
      .sort((a, b) => a.start - b.start);

    let covered = -1;
    for (const span of spans) {
      const start = Math.max(span.start, covered + 1);
      if (start > span.end) continue;
      covered = span.end;
      chapters.push({
        endMs: lines[span.end].endMs,
        segmentIds: lines.slice(start, span.end + 1).map((line) => line.segmentId),
        startMs: lines[start].startMs,
        title: clip(span.title, MAX_TITLE),
      });
    }
  }

  const decisions = raw.decisions.map((decision): MeetingDecision => ({
    segmentIds: cite(decision.segmentIndexes).map((index) => lines[index].segmentId),
    text: clip(decision.text, MAX_TEXT),
  }));

  const actionItems = raw.actionItems.map((item, index): MeetingActionItem => {
    const cited = cite(item.segmentIndexes);
    const source = cited.length > 0 ? lines[cited[0]] : undefined;
    const assigneeHint = item.assignee.trim() || undefined;
    const assignee = options.resolveAssignee(assigneeHint, source?.speakerLabel);

    return {
      ...(assignee && { assignee }),
      ...(assigneeHint && { assigneeHint: clip(assigneeHint, MAX_TITLE) }),
      ...(parseDueDate(item.dueDate) && { dueDate: parseDueDate(item.dueDate) }),
      id: options.actionItemId(index),
      segmentIds: cited.map((lineIndex) => lines[lineIndex].segmentId),
      ...(source?.speakerLabel && { speakerLabel: source.speakerLabel }),
      ...(source && { startMs: source.startMs }),
      status: 'suggested',
      text: clip(item.text, MAX_TEXT),
    };
  });

  const keywords = [
    ...new Set(raw.keywords.map((keyword) => keyword.trim()).filter(Boolean)),
  ].slice(0, MAX_KEYWORDS);

  return { actionItems, chapters, decisions, keywords, summary: clip(raw.summary, 20_000) };
};
