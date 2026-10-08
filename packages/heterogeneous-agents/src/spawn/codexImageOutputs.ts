import { readFile } from 'node:fs/promises';

import { isRecord } from '@lobechat/utils/object';

import type { CodexImageOutputItem } from '../adapters/codex';
import { parseJsonlRecords } from '../transcript/utils';
import type { HeterogeneousToolResultImage } from '../types';
import { getCodexHome, readNewestMatchingSessionFile } from './codexModel';

/**
 * exec --json omits built-in tool outputs, including images returned through exec.
 * Recover only this invocation's latest turn, never historical images on resume.
 */
export const readCodexImageOutputs = async (
  sessionId: string,
  { env, startedAt }: { env: Record<string, string | undefined>; startedAt: number },
): Promise<CodexImageOutputItem[]> => {
  const source = await readNewestMatchingSessionFile(getCodexHome(env), sessionId);
  if (!source) return [];
  const records = parseJsonlRecords(await readFile(source, 'utf8'));
  const turnStart = records.findLastIndex(
    (record) =>
      isRecord(record) &&
      record.type === 'event_msg' &&
      isRecord(record.payload) &&
      record.payload.type === 'task_started',
  );
  const timestamp = records[turnStart]?.timestamp;
  const turnStartedAt = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(turnStartedAt) || turnStartedAt < startedAt) return [];

  const outputs = new Map<string, CodexImageOutputItem>();
  for (const record of records.slice(turnStart + 1)) {
    if (!isRecord(record)) continue;
    const payload = record.payload;
    if (
      record.type !== 'response_item' ||
      !isRecord(payload) ||
      (payload.type !== 'custom_tool_call_output' && payload.type !== 'function_call_output') ||
      typeof payload.call_id !== 'string' ||
      !Array.isArray(payload.output)
    )
      continue;

    const images: HeterogeneousToolResultImage[] = [];
    for (const block of payload.output) {
      if (!isRecord(block) || block.type !== 'input_image' || typeof block.image_url !== 'string')
        continue;
      const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(block.image_url);
      if (match) images.push({ data: match[2], mediaType: match[1] });
    }
    if (images.length > 0) {
      outputs.set(payload.call_id, {
        id: payload.call_id,
        images,
        status: 'completed',
        type: 'image_output',
      });
    }
  }
  return [...outputs.values()];
};
