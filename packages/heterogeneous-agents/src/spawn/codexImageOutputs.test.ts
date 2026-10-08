import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readCodexImageOutputs } from './codexImageOutputs';

const tempDirs: string[] = [];
const startedAt = Date.parse('2026-10-08T02:52:15.000Z');
const record = (payload: unknown, type = 'response_item', timestamp = '2026-10-08T02:52:16.000Z') =>
  JSON.stringify({ payload, timestamp, type });
const imageOutput = (callId: string, urls: string[]) => ({
  call_id: callId,
  output: urls.map((image_url) => ({ image_url, type: 'input_image' })),
  type: 'custom_tool_call_output',
});

const prepare = async (content: string) => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'codex-image-output-'));
  tempDirs.push(codexHome);
  const dir = path.join(codexHome, 'sessions', '2026', '10', '08');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'rollout-thread-1.jsonl'), content);
  return { env: { CODEX_HOME: codexHome }, startedAt };
};

describe('readCodexImageOutputs', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('keeps image order, ignores non-image URLs and deduplicates echoed outputs', async () => {
    const output = imageOutput('call-image', [
      'data:image/png;base64,AAAA',
      'data:image/jpeg;base64,BBBB',
      'data:text/plain;base64,CCCC',
      'file:///private/image.png',
    ]);
    const options = await prepare(
      [
        record({ type: 'task_started' }, 'event_msg'),
        record(output),
        'null',
        record(output),
        '{truncated',
      ].join('\n'),
    );
    expect(await readCodexImageOutputs('thread-1', options)).toEqual([
      {
        id: 'call-image',
        images: [
          { data: 'AAAA', mediaType: 'image/png' },
          { data: 'BBBB', mediaType: 'image/jpeg' },
        ],
        status: 'completed',
        type: 'image_output',
      },
    ]);
  });

  it.each(['2026-10-08T02:50:00.000Z', 'invalid'])(
    'does not replay an old or undated turn (%s)',
    async (timestamp) => {
      const options = await prepare(
        [
          record({ type: 'task_started' }, 'event_msg', timestamp),
          record(imageOutput('old', ['data:image/png;base64,AAAA'])),
        ].join('\n'),
      );
      expect(await readCodexImageOutputs('thread-1', options)).toEqual([]);
    },
  );

  it('does not confuse another session with the requested session', async () => {
    const options = await prepare(
      [
        record({ type: 'task_started' }, 'event_msg'),
        record(imageOutput('other', ['data:image/png;base64,AAAA'])),
      ].join('\n'),
    );
    expect(await readCodexImageOutputs('thread-missing', options)).toEqual([]);
  });
});
