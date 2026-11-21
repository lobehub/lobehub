import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Format from '../../../utils/format';
import { log } from '../../../utils/logger';
import { REPORT_FILE, REVIEWS_FILE } from './acceptanceDir';
import { decideLocalAcceptance } from './decision';
import { loadLocalAcceptance } from './localAcceptance';
import { readLocalBundle } from './localBundle';
import { createLocalAcceptance, firstRound } from './testUtils';

const { outputJson } = vi.hoisted(() => ({ outputJson: vi.fn() }));
vi.mock('../../../utils/format', async (original) => ({
  ...(await original<typeof Format>()),
  outputJson,
}));

const TEMPLATE =
  '<html><head><!--ACCEPTANCE_LOCAL_TITLE--></head><body><!--ACCEPTANCE_LOCAL_DATA--></body></html>';

describe('lh acceptance accept|reject <acceptanceDir>', () => {
  let fixture: ReturnType<typeof createLocalAcceptance>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    fixture = createLocalAcceptance([firstRound()]);
    vi.stubEnv('LOBEHUB_ACCEPTANCE_DOWNLOADS', path.join(fixture.root, 'Downloads'));
    vi.stubEnv('HOME', fixture.root);
    const template = path.join(fixture.root, 'template.html');
    writeFileSync(template, TEMPLATE);
    vi.stubEnv('LOBEHUB_ACCEPTANCE_REPORT_TEMPLATE', template);
    loadLocalAcceptance(fixture.acceptanceDir, { create: true });
  });

  afterEach(() => {
    fixture.cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('accepts the delivery offline, so view reads it accepted', async () => {
    const reportPath = path.join(fixture.acceptanceDir, REPORT_FILE);
    writeFileSync(reportPath, 'stale');

    await decideLocalAcceptance(fixture.acceptanceDir, 'accept', { json: true });

    expect(outputJson.mock.calls[0]![0]).toMatchObject({
      decision: { action: 'accept', kind: 'decision', roundIndex: 1 },
      reportPath,
      status: 'accepted',
    });
    expect(readLocalBundle(fixture.acceptanceDir).bundle.acceptance.status).toBe('accepted');
    // The page carries the decision too.
    expect(readFileSync(reportPath, 'utf8')).toContain('"kind":"decision"');
  });

  it('records the reject reason the next round reads, without a page to refresh', async () => {
    await decideLocalAcceptance(fixture.acceptanceDir, 'reject', {
      comment: 'Focus is lost',
      json: true,
    });
    const { bundle } = readLocalBundle(fixture.acceptanceDir);
    expect(bundle.acceptance.status).toBe('rejected');
    expect(bundle.rounds[0]!.run.decisionDetail?.comment).toBe('Focus is lost');
    expect(outputJson.mock.calls[0]![0].reportPath).toBeNull();
    expect(existsSync(path.join(fixture.acceptanceDir, REPORT_FILE))).toBe(false);
  });

  it('refuses a second decision on the same round, like the server', async () => {
    await decideLocalAcceptance(fixture.acceptanceDir, 'accept', { json: true });
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(
      decideLocalAcceptance(fixture.acceptanceDir, 'reject', { comment: 'late' }),
    ).rejects.toThrow('exit');
    expect(error).toHaveBeenCalledWith('This delivery has already been accepted');
    expect(exit).toHaveBeenCalledWith(1);
    const saved = JSON.parse(readFileSync(path.join(fixture.acceptanceDir, REVIEWS_FILE), 'utf8'));
    expect(saved.events).toHaveLength(1);
  });
});
