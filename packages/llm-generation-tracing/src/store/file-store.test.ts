import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TracingPayload } from '../types';
import { DEFAULT_DIR, FileTracingStore } from './file-store';

let tmpRoot: string;

const makePayload = (overrides: Partial<TracingPayload> = {}): TracingPayload => ({
  created_at: new Date('2026-05-22T11:22:33.444Z').getTime(),
  prompt_hash: 'abcdef',
  prompt_version: 'v1.0',
  scenario: 'home_brief',
  tracing_id: '00000000-0000-0000-0000-000000000001',
  version: '1.0',
  ...overrides,
});

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-gen-trace-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { force: true, recursive: true });
});

describe('FileTracingStore', () => {
  it('writes payloads under {scenario}/{promptVersion}-{promptHash}/ and returns a null key (local-only)', async () => {
    const store = new FileTracingStore(tmpRoot);
    const payload = makePayload();

    const { key } = await store.save(payload);
    // Local store is non-shareable — DB should leave `storage_key` empty.
    expect(key).toBeNull();

    const dir = path.join(tmpRoot, DEFAULT_DIR, 'home_brief', 'v1.0-abcdef');
    const entries = await fs.readdir(dir);
    const jsonFiles = entries.filter((f) => f.endsWith('.json'));
    expect(jsonFiles).toHaveLength(1);

    const raw = await fs.readFile(path.join(dir, jsonFiles[0]), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({
      prompt_hash: 'abcdef',
      scenario: 'home_brief',
      tracing_id: payload.tracing_id,
    });
  });

  it('updates the latest.json symlink to point at the freshest record', async () => {
    const store = new FileTracingStore(tmpRoot);
    await store.save(makePayload({ tracing_id: 'aaaa-1' }));
    await store.save(
      makePayload({
        created_at: new Date('2026-05-22T11:30:00.000Z').getTime(),
        scenario: 'topic_title',
        tracing_id: 'bbbb-2',
      }),
    );

    const latestPath = path.join(tmpRoot, DEFAULT_DIR, 'latest.json');
    const target = await fs.realpath(latestPath);
    const content = await fs.readFile(target, 'utf8');
    expect(JSON.parse(content)).toMatchObject({
      scenario: 'topic_title',
      tracing_id: 'bbbb-2',
    });
  });

  it('lists recent records as flat summaries newest-first', async () => {
    const store = new FileTracingStore(tmpRoot);
    await store.save(
      makePayload({
        created_at: new Date('2026-05-22T11:00:00.000Z').getTime(),
        scenario: 'home_brief',
        tracing_id: 'aaaa',
      }),
    );
    await store.save(
      makePayload({
        created_at: new Date('2026-05-22T12:00:00.000Z').getTime(),
        scenario: 'memory_extract',
        tracing_id: 'bbbb',
      }),
    );

    const summaries = await store.list();
    expect(summaries.map((s) => s.tracing_id)).toEqual(['bbbb', 'aaaa']);
  });

  it('round-trips a payload via get() using the on-disk file path', async () => {
    const store = new FileTracingStore(tmpRoot);
    const payload = makePayload({
      input: { messages: [{ content: 'hi', role: 'user' }] },
      output: { topic: 'greeting' },
    });
    await store.save(payload);

    // save() returns a null key, so locate the file on disk and read via its path.
    const dir = path.join(tmpRoot, DEFAULT_DIR, 'home_brief', 'v1.0-abcdef');
    const jsonFile = (await fs.readdir(dir)).find((f) => f.endsWith('.json'));
    if (!jsonFile) throw new Error('expected a saved tracing file to exist');
    const loaded = await store.get(path.join(dir, jsonFile));
    expect(loaded).toMatchObject({
      input: { messages: [{ content: 'hi', role: 'user' }] },
      output: { topic: 'greeting' },
      tracing_id: payload.tracing_id,
    });
  });

  it('returns null when get() targets a missing key', async () => {
    const store = new FileTracingStore(tmpRoot);
    expect(await store.get('not/a/real/key.json')).toBeNull();
  });
});
