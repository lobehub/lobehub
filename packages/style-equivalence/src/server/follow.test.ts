import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRunSource, newestRun, parseRunName } from './follow';
import { startServer } from './index';

const FIRST = '2026-11-05T12-54-12-846Z-784d72f-27c333a';
const SECOND = '2026-11-05T13-06-44-811Z-784d72f-27c333a';
const THIRD = '2026-11-05T13-20-00-000Z-784d72f-9a8b7c6';

let records: string;

const addRun = async (
  name: string,
  { complete = true, pr, results }: { complete?: boolean; pr?: number; results?: string } = {},
) => {
  const dir = path.join(records, name);
  await mkdir(dir, { recursive: true });
  const parsed = parseRunName(name);
  await writeFile(
    path.join(dir, 'run.json'),
    JSON.stringify({
      base: parsed?.base,
      head: parsed?.head,
      runId: name,
      ...(pr ? { pr: { number: pr } } : {}),
    }),
  );
  if (complete)
    await writeFile(path.join(dir, 'results.json'), results ?? JSON.stringify({ cases: [] }));
  return dir;
};

beforeEach(async () => {
  records = await mkdtemp(path.join(tmpdir(), 'style-eq-follow-'));
});

afterEach(async () => {
  await rm(records, { force: true, recursive: true });
});

describe('the run a report server follows', () => {
  it('reads the start time, base and head from a run directory name', () => {
    expect(parseRunName(FIRST)).toMatchObject({
      base: '784d72f',
      head: '27c333a',
      startedAt: '2026-11-05T12:54:12.846Z',
    });
    expect(parseRunName(`${FIRST}-2`)!.order).toBeGreaterThan(parseRunName(FIRST)!.order);
    expect(parseRunName('run-1')).toBeUndefined();
  });

  it('picks the newest complete run on the same base, whatever its head', async () => {
    await addRun(FIRST);
    await addRun(SECOND);
    await addRun(THIRD);
    expect(await newestRun(records, FIRST)).toBe(THIRD);
  });

  it('ignores runs on another base, runs still being written and older runs', async () => {
    await addRun('2026-11-05T11-00-00-000Z-784d72f-1111111');
    await addRun(FIRST);
    await addRun('2026-11-05T13-30-00-000Z-60dee14-27c333a');
    await addRun(THIRD, { complete: false });
    expect(await newestRun(records, FIRST)).toBe(FIRST);
  });

  it('stays on the line of the same pull request when the run has one', async () => {
    await addRun(FIRST, { pr: 21449 });
    await addRun(SECOND, { pr: 21449 });
    await addRun(THIRD, { pr: 21450 });
    expect(await newestRun(records, FIRST, 21449)).toBe(SECOND);
  });

  it('keeps a directory it cannot read as a run name where it is', async () => {
    expect(await newestRun(records, 'run-1')).toBe('run-1');
  });

  it('switches to a newer run once it lands and reports that it moved', async () => {
    const first = await addRun(FIRST);
    const source = await createRunSource({ recordsDir: records, runDir: first });
    let { dir, stored } = await source.current();
    expect(source.info(stored, dir)).toMatchObject({
      pinned: false,
      requested: FIRST,
      runId: FIRST,
    });
    await addRun(THIRD);
    ({ dir, stored } = await source.current());
    expect(source.info(stored, dir)).toMatchObject({
      head: '9a8b7c6',
      requested: FIRST,
      runId: THIRD,
      startedAt: '2026-11-05T13:20:00.000Z',
    });
  });

  it('keeps serving the run it has while the newest one does not parse yet', async () => {
    const first = await addRun(FIRST);
    await addRun(THIRD, { results: '{"cases": [' });
    const source = await createRunSource({ recordsDir: records, runDir: first });
    const { dir } = await source.current();
    expect(path.basename(dir)).toBe(FIRST);
  });

  it('serves exactly the given run when pinned', async () => {
    const first = await addRun(FIRST);
    await addRun(THIRD);
    const source = await createRunSource({ pin: true, recordsDir: records, runDir: first });
    const { dir, stored } = await source.current();
    expect(source.info(stored, dir)).toMatchObject({ pinned: true, runId: FIRST });
  });

  it('answers every request from the newest run, builds included', async () => {
    const first = await addRun(FIRST);
    await mkdir(path.join(first, 'dist-base'));
    await writeFile(path.join(first, 'dist-base/index.html'), 'first build');
    const server = await startServer({ recordsDir: records, runDir: first, uiDir: records });
    try {
      const third = await addRun(THIRD);
      await mkdir(path.join(third, 'dist-base'));
      await writeFile(path.join(third, 'dist-base/index.html'), 'third build');
      expect(await (await fetch(`${server.url}/api/current`)).json()).toMatchObject({
        requested: FIRST,
        runId: THIRD,
      });
      expect((await (await fetch(`${server.url}/api/run`)).json()).follow.runId).toBe(THIRD);
      expect(await (await fetch(`${server.url}/base/`)).text()).toBe('third build');
    } finally {
      await server.stop();
    }
  });
});
