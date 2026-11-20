import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Format from '../../../utils/format';
import { log } from '../../../utils/logger';
import { renderReportAction } from './render';
import { renderReportHtml } from './reportTemplate';
import { createLocalAcceptance, firstRound } from './testUtils';

const { outputJson, spawn } = vi.hoisted(() => ({
  outputJson: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('../../../utils/format', async (original) => ({
  ...(await original<typeof Format>()),
  outputJson,
}));

const TEMPLATE =
  '<html><head><!--ACCEPTANCE_LOCAL_TITLE--><script type="module">const slot = "<\\!--ACCEPTANCE_LOCAL_DATA-->";</script></head><body><!--ACCEPTANCE_LOCAL_DATA--></body></html>';

const embedded = (html: string) => {
  const match = html.match(
    /<script id="acceptance-local-data" type="application\/json">(.*?)<\/script>/s,
  );
  return match ? JSON.parse(match[1]!) : undefined;
};

describe('lh acceptance run render', () => {
  let fixture: ReturnType<typeof createLocalAcceptance>;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    spawn.mockImplementation(() => Object.assign(new EventEmitter(), { unref: () => {} }));
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    fixture = createLocalAcceptance([firstRound()]);
    const template = path.join(fixture.root, 'acceptance-report.html');
    writeFileSync(template, TEMPLATE);
    vi.stubEnv('LOBEHUB_ACCEPTANCE_REPORT_TEMPLATE', template);
    vi.stubEnv('LOBEHUB_ACCEPTANCE_DOWNLOADS', path.join(fixture.root, 'Downloads'));
    vi.stubEnv('HOME', fixture.root);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    fixture.cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('writes the whole acceptance into one offline page next to its rounds', async () => {
    const roundDir = path.join(fixture.acceptanceDir, '20260101-090000-first');
    await renderReportAction(roundDir, { json: true, requirement: 'Users can rename a topic' });

    const reportPath = path.join(fixture.acceptanceDir, 'report.html');
    const html = readFileSync(reportPath, 'utf8');
    expect(html).toContain('<title>Topic rename</title>');
    // The data lands in <body>, not in the page script's look-alike string.
    expect(html).toContain('const slot = "<\\!--ACCEPTANCE_LOCAL_DATA-->"');
    const data = embedded(html);
    expect(data.acceptance).toMatchObject({ requirement: 'Users can rename a topic' });
    expect(data.rounds).toHaveLength(1);

    const summary = outputJson.mock.calls[0]![0];
    expect(summary).toMatchObject({
      cases: 1,
      droppedProgrammaticChecks: ['unit — Unit tests pass'],
      missingEvidence: [{ checkItemId: 'enter', types: ['video'] }],
      mode: 'local',
      publicationStatus: 'partial',
      reportPath,
      roundIndex: 1,
      rounds: 1,
    });
    expect(summary.reportUrl).toMatch(/^file:\/\//);
    // Incomplete evidence fails like a partial ingest does.
    expect(process.exitCode).toBe(1);
  });

  it('re-renders every round into the same page', async () => {
    await renderReportAction(fixture.acceptanceDir, { json: true });
    const round = firstRound();
    round.dir = '20260102-090000-second';
    fixture.addRound(round);
    await renderReportAction(path.join(fixture.acceptanceDir, round.dir), { json: true });

    const data = embedded(readFileSync(path.join(fixture.acceptanceDir, 'report.html'), 'utf8'));
    expect(data.rounds.map((item: { dir: string }) => item.dir)).toEqual([
      '20260101-090000-first',
      '20260102-090000-second',
    ]);
    expect(outputJson.mock.calls.at(-1)![0]).toMatchObject({ roundIndex: 2, rounds: 2 });
  });

  it.each(['synchronous', 'asynchronous'])(
    '%s browser failure keeps the rendered report usable',
    async (failure) => {
      const child = Object.assign(new EventEmitter(), { unref: () => {} });
      const error = new Error('spawn xdg-open ENOENT');
      spawn.mockImplementationOnce(() => {
        if (failure === 'synchronous') throw error;
        return child;
      });
      fixture.addRound({
        dir: '20260102-090000-complete',
        result: {
          cases: [{ id: 'rename', name: 'Rename keeps the new title', status: 'pass' }],
          title: 'Topic rename',
        },
      });

      const summary = await renderReportAction(fixture.acceptanceDir, {
        json: true,
        open: true,
        requirement: 'Users can rename a topic',
      });
      if (failure === 'asynchronous') {
        await Promise.resolve();
        expect(() => child.emit('error', error)).not.toThrow();
      }

      expect(summary.publicationStatus).toBe('complete');
      expect(process.exitCode).toBeUndefined();
      expect(embedded(readFileSync(summary.reportPath, 'utf8')).rounds).toHaveLength(2);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(error.message));
    },
  );

  it('opens the page on Windows without handing its path to a shell', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    const roundDir = path.join(fixture.acceptanceDir, '20260101-090000-first');
    try {
      await renderReportAction(roundDir, { json: true, open: true });
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }

    const reportPath = path.join(fixture.acceptanceDir, 'report.html');
    expect(spawn).toHaveBeenCalledWith(
      'rundll32',
      ['url.dll,FileProtocolHandler', reportPath],
      expect.objectContaining({ detached: true }),
    );
  });
});

describe('renderReportHtml', () => {
  it('keeps the embedded JSON from closing its script element', () => {
    const html = renderReportHtml(
      TEMPLATE,
      {
        acceptance: {
          createdAt: '2026-01-01T00:00:00.000Z',
          id: 'a',
          requirement: '</script><script>alert(1)</script>',
          subjectKey: 'standalone-x',
        },
        format: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        reviews: [],
        rounds: [],
      },
      'A <b> title',
    );
    expect(html).toContain('<title>A &lt;b&gt; title</title>');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(embedded(html).acceptance.requirement).toBe('</script><script>alert(1)</script>');
  });
});
