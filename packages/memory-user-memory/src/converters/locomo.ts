import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { MemorySourceType } from '@lobechat/types';
import { MemorySourceType as MemorySourceTypeEnum } from '@lobechat/types';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';

export type LocomoQASample = {
  conversation: Record<string, unknown>;
  qa: unknown[];
  sample_id: string;
};

export type LocomoTurn = {
  blip_caption?: string | string[];
  dia_id?: string;
  img_url?: string | string[];
  query?: string;
  speaker: string;
  text: string;
};

export type LocomoSession = {
  dateTime?: string;
  id: string;
  turns: LocomoTurn[];
};

export type IngestTurnPayload = {
  createdAt?: string;
  diaId?: string;
  imageCaption?: string;
  imageUrls?: string[];
  role: string;
  speaker: string;
  text: string;
};

export type IngestSessionPayload = {
  sessionId: string;
  timestamp?: string;
  turns: IngestTurnPayload[];
};

export type IngestPayload = {
  force: boolean;
  layers: string[];
  sampleId: string;
  sessions: IngestSessionPayload[];
  source: MemorySourceType;
  topicId: string;
};

export type BuildIngestOptions = {
  includeImageCaptions?: boolean;
  layers?: string[];
  source?: MemorySourceType;
  speakerRoles?: {
    defaultRole?: string;
    speakerA?: string;
    speakerB?: string;
  };
  topicIdPrefix?: string;
};

const SESSION_KEY_REGEX = /^session_(\d+)$/;

dayjs.extend(customParseFormat);
dayjs.extend(utc);

const parseDate = (value?: string) => {
  if (!value) return undefined;

  const formats = ['h:mm a [on] D MMMM, YYYY', 'h:mm a [on] D MMM, YYYY'];
  for (const format of formats) {
    const parsed = dayjs.utc(value, format, true);
    if (parsed.isValid()) return parsed.toISOString();
  }

  console.warn(
    `[locomo converter] failed to parse date "${value}" with custom format, falling back to Date parser`,
  );
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback.toISOString();
};

const normalizeArray = (value?: string | string[]) => {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
};

const buildTurnText = (turn: LocomoTurn, includeImageCaptions?: boolean) => {
  const captions = normalizeArray(turn.blip_caption);
  if (!includeImageCaptions || captions.length === 0) return turn.text;

  const suffix = captions.map((caption) => `[Image: ${caption}]`).join('\n');
  return `${turn.text}${turn.text.endsWith('\n') ? '' : '\n'}${suffix}`;
};

const extractSessions = (conversation: Record<string, unknown>): LocomoSession[] => {
  const sessions: { order: number; session: LocomoSession }[] = [];

  Object.entries(conversation).forEach(([key, value]) => {
    const match = key.match(SESSION_KEY_REGEX);
    if (!match || !Array.isArray(value)) return;

    const dateTime = conversation[`${key}_date_time`] as string | undefined;
    const turns = (value as unknown[]).filter(Boolean) as LocomoTurn[];

    sessions.push({ order: Number.parseInt(match[1], 10), session: { dateTime, id: key, turns } });
  });

  return sessions.sort((a, b) => a.order - b.order).map(({ session }) => session);
};

const resolveRole = (
  speaker: string,
  speakerAName: string | undefined,
  speakerBName: string | undefined,
  roles?: BuildIngestOptions['speakerRoles'],
) => {
  if (speakerAName && speaker === speakerAName) return roles?.speakerA || 'user';
  if (speakerBName && speaker === speakerBName) return roles?.speakerB || 'assistant';

  return roles?.defaultRole || 'user';
};

export const buildIngestPayload = (
  sample: LocomoQASample,
  options: BuildIngestOptions,
): IngestPayload => {
  const speakerA = sample.conversation['speaker_a'] as string | undefined;
  const speakerB = sample.conversation['speaker_b'] as string | undefined;

  const sessions = extractSessions(sample.conversation);
  const sessionPayloads: IngestSessionPayload[] = sessions.map((session) => {
    if (!session.dateTime) {
      console.warn(
        `[locomo converter] session ${session.id} is missing dateTime, turns will have no createdAt`,
      );
    }

    console.log(
      `[locomo converter] processing sample ${sample.sample_id} session ${session.id} (on ${session.dateTime ?? 'unknown dateTime'}) with ${session.turns.length} turns`,
    );

    return {
      sessionId: session.id,
      timestamp: parseDate(session.dateTime),
      turns: session.turns.map((turn) => ({
        createdAt: parseDate(session.dateTime),
        diaId: turn.dia_id,
        imageCaption: normalizeArray(turn.blip_caption).join('\n') || undefined,
        imageUrls: normalizeArray(turn.img_url).length ? normalizeArray(turn.img_url) : undefined,
        role: resolveRole(turn.speaker, speakerA, speakerB, options.speakerRoles),
        speaker: turn.speaker,
        text: buildTurnText(turn, options.includeImageCaptions),
      })),
    };
  });

  return {
    force: true,
    layers: options.layers ?? [],
    sampleId: sample.sample_id,
    sessions: sessionPayloads,
    source: options.source ?? MemorySourceTypeEnum.BenchmarkLocomo,
    topicId: `${options.topicIdPrefix ?? 'sample'}_${sample.sample_id}`,
  };
};

export const loadLocomoFile = (filePath: string): LocomoQASample[] => {
  const absPath = resolve(filePath);
  const raw = readFileSync(absPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('Expected LoCoMo JSON to be an array of samples');
  }

  return parsed as LocomoQASample[];
};

export const convertLocomoFile = (filePath: string, options: BuildIngestOptions): IngestPayload[] =>
  loadLocomoFile(filePath).map((sample) => buildIngestPayload(sample, options));
