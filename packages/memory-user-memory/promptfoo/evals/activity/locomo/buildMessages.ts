import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import { MemorySourceType } from '@lobechat/types';

import type { IngestPayload } from '../../../../src/converters/locomo';
import { activityPrompt } from '../../../../src/prompts';
import type { BenchmarkLocomoPart } from '../../../../src/providers';
import { BenchmarkLocomoContextProvider } from '../../../../src/providers';
import type { ExtractorTemplateProps, MemoryExtractionJob } from '../../../../src/types';

export interface PromptVars extends ExtractorTemplateProps {
  payloadPath: string;
  sessionId?: string;
  userId?: string;
}

const resolvePath = (payloadPath: string) =>
  isAbsolute(payloadPath) ? payloadPath : join(process.cwd(), payloadPath);

const buildParts = (payload: IngestPayload, sessionId?: string): BenchmarkLocomoPart[] => {
  let partIndex = 0;
  const sessions = payload.sessions.filter(
    (session) => !sessionId || session.sessionId === sessionId,
  );

  return sessions.flatMap((session) =>
    session.turns.map((turn) => {
      const metadata = {
        diaId: turn.diaId,
        imageCaption: turn.imageCaption,
        imageUrls: turn.imageUrls,
        sessionId: session.sessionId,
      };

      return {
        content: turn.text,
        createdAt: turn.createdAt || session.timestamp,
        metadata,
        partIndex: partIndex++,
        sessionId: session.sessionId,
        speaker: turn.speaker,
      };
    }),
  );
};

const resolveSessionDate = (
  payload: IngestPayload,
  parts: BenchmarkLocomoPart[],
  sessionId?: string,
) => {
  const sessionDate =
    payload.sessions.find((session) => session.sessionId === sessionId)?.timestamp ||
    payload.sessions[0]?.timestamp;

  if (sessionDate) return sessionDate;

  const latestCreatedAt = parts
    .map((part) => (part.createdAt ? new Date(part.createdAt) : null))
    .filter(Boolean)
    .sort((a, b) => (a!.getTime() > b!.getTime() ? 1 : -1))
    .at(-1);

  return latestCreatedAt ? latestCreatedAt.toISOString() : new Date().toISOString();
};

export const buildLocomoActivityMessages = async (vars: PromptVars) => {
  const payloadPath = resolvePath(vars.payloadPath);
  const payloadRaw = await readFile(payloadPath, 'utf8');
  const payload = JSON.parse(payloadRaw) as IngestPayload;

  const parts = buildParts(payload, vars.sessionId);
  if (parts.length === 0) {
    throw new Error(
      `No matching parts found in ${payload.sampleId} for session ${vars.sessionId || 'all'}`,
    );
  }
  const userId = vars.userId || `locomo-user-${payload.sampleId}`;
  const sourceId = payload.topicId || `sample_${payload.sampleId}`;
  const sessionDate = vars.sessionDate || resolveSessionDate(payload, parts, vars.sessionId);

  const provider = new BenchmarkLocomoContextProvider({
    parts,
    sampleId: payload.sampleId,
    sourceId,
    userId,
  });

  const extractionJob: MemoryExtractionJob = {
    source: MemorySourceType.BenchmarkLocomo,
    sourceId,
    userId,
  };

  const { context } = await provider.buildContext(extractionJob.userId);

  const rendered = renderPlaceholderTemplate(activityPrompt, {
    availableCategories: vars.availableCategories,
    language: vars.language || 'English',
    retrievedContext: context || 'No similar memories retrieved.',
    sessionDate,
    topK: vars.topK ?? 5,
    username: vars.username || 'User',
  });

  return [
    { content: rendered, role: 'system' as const },
    { content: rendered, role: 'user' as const },
  ];
};
