import type { VerifyTerminalEvidenceMetadata } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  formatTerminalDuration,
  readTerminalArtifactLinks,
  resolveTerminalViews,
  searchTerminalLines,
  splitTerminalLines,
  terminalFoldTitle,
  terminalOutcomeLabel,
  terminalOutcomeTone,
  terminalReplayError,
} from './model';

const SHA = 'a'.repeat(64);
const artifact = (size: number) => ({ fileId: `file-${size}`, sha256: SHA, size });

const record = (
  overrides: {
    artifacts?: VerifyTerminalEvidenceMetadata['artifacts'];
    capture?: Partial<VerifyTerminalEvidenceMetadata['capture']>;
    execution?: Partial<VerifyTerminalEvidenceMetadata['execution']>;
    source?: VerifyTerminalEvidenceMetadata['source'];
  } = {},
): VerifyTerminalEvidenceMetadata => ({
  artifacts: overrides.artifacts ?? { stderr: artifact(0), stdout: artifact(12) },
  capture: { mode: 'pipe', streamLayout: 'separate', timing: 'unavailable', ...overrides.capture },
  execution: {
    command: 'pnpm test',
    cwd: '/repo',
    durationMs: 1200,
    environmentSummary: {},
    exitCode: 0,
    finishedAt: null,
    outcome: 'exited',
    signal: null,
    startedAt: null,
    ...overrides.execution,
  },
  processing: { missingFields: [], notes: [], redactions: [], truncation: [] },
  source: overrides.source ?? { kind: 'captured' },
  version: 1,
});

const link = (url: string | null, size = 12) => ({ fileUrl: url, sha256: SHA, size });

describe('readTerminalArtifactLinks', () => {
  it('keeps well-formed links and drops malformed ones', () => {
    expect(
      readTerminalArtifactLinks({
        bogus: link('https://x/bogus'),
        cast: { fileUrl: 'https://x/cast' },
        stderr: link(''),
        stdout: link('https://x/out'),
      }),
    ).toEqual({ stderr: link(null), stdout: link('https://x/out') });
    expect(readTerminalArtifactLinks(null)).toEqual({});
    expect(readTerminalArtifactLinks([link('x')])).toEqual({});
  });
});

describe('terminalOutcomeTone', () => {
  it('maps outcomes to tones without inventing success', () => {
    expect(terminalOutcomeTone({ exitCode: 0, outcome: 'exited' })).toBe('success');
    expect(terminalOutcomeTone({ exitCode: 2, outcome: 'exited' })).toBe('error');
    expect(terminalOutcomeTone({ exitCode: null, outcome: 'exited' })).toBe('neutral');
    expect(terminalOutcomeTone({ exitCode: null, outcome: 'unknown' })).toBe('neutral');
    expect(terminalOutcomeTone({ exitCode: 0, outcome: 'unknown' })).toBe('success');
    expect(terminalOutcomeTone({ exitCode: null, outcome: 'signaled' })).toBe('error');
    expect(terminalOutcomeTone({ exitCode: null, outcome: 'timed_out' })).toBe('error');
    expect(terminalOutcomeTone({ exitCode: null, outcome: 'spawn_failed' })).toBe('error');
    expect(terminalOutcomeTone({ exitCode: null, outcome: 'interrupted' })).toBe('warning');
    expect(terminalOutcomeTone({ exitCode: 0, outcome: 'capture_failed' })).toBe('warning');
  });
});

describe('terminalOutcomeLabel', () => {
  it('names the exit code, signal or unknown state', () => {
    expect(terminalOutcomeLabel({ exitCode: 1, outcome: 'exited', signal: null })).toEqual({
      key: 'report.terminal.outcome.exit',
      values: { code: 1 },
    });
    expect(
      terminalOutcomeLabel({ exitCode: null, outcome: 'signaled', signal: 'SIGKILL' }),
    ).toEqual({ key: 'report.terminal.outcome.signaled', values: { signal: 'SIGKILL' } });
    expect(terminalOutcomeLabel({ exitCode: null, outcome: 'signaled', signal: null }).key).toBe(
      'report.terminal.outcome.signaledUnknown',
    );
    expect(terminalOutcomeLabel({ exitCode: null, outcome: 'unknown', signal: null }).key).toBe(
      'report.terminal.outcome.unknown',
    );
    expect(
      terminalOutcomeLabel({ exitCode: null, outcome: 'timed_out', signal: 'SIGTERM' }).key,
    ).toBe('report.terminal.outcome.timedOut');
  });
});

describe('formatTerminalDuration', () => {
  it('stays precise for short runs', () => {
    expect(formatTerminalDuration(850)).toBe('850 ms');
    expect(formatTerminalDuration(1234)).toBe('1.23 s');
    expect(formatTerminalDuration(12_345)).toBe('12.3 s');
    expect(formatTerminalDuration(187_000)).toBe('3m 7s');
  });
});

describe('resolveTerminalViews', () => {
  const base = { content: '$ pnpm test\n--- stdout ---\nok\n', id: 'e1' };

  it('falls back to the transcript alone without a readable record', () => {
    const plan = resolveTerminalViews({ ...base, metadata: { terminal: { version: 2 } } });
    expect(plan.terminal).toBeUndefined();
    expect(plan.views.map((view) => view.key)).toEqual(['transcript']);
    expect(plan.defaultView).toBe('transcript');
    expect(plan.views[0]!.source).toEqual({ kind: 'inline', text: base.content });
  });

  it('uses the payload file when there is no inline content', () => {
    const plan = resolveTerminalViews({ fileUrl: 'https://x/payload', id: 'e1' });
    expect(plan.views[0]!.source).toEqual({ kind: 'url', url: 'https://x/payload' });
  });

  it('splits a pipe capture into stdout and stderr, an empty stream needing no fetch', () => {
    const plan = resolveTerminalViews({
      ...base,
      metadata: { terminal: record() },
      terminalArtifacts: { stdout: link('https://x/stdout') },
    });
    expect(plan.views.map((view) => [view.key, view.source.kind])).toEqual([
      ['stdout', 'url'],
      ['stderr', 'empty'],
      ['transcript', 'inline'],
    ]);
    expect(plan.defaultView).toBe('stdout');
    expect(plan.replayUrl).toBeUndefined();
  });

  it('opens on stderr when stdout is empty', () => {
    const plan = resolveTerminalViews({
      ...base,
      metadata: { terminal: record({ artifacts: { stderr: artifact(30), stdout: null } }) },
      terminalArtifacts: { stderr: link('https://x/stderr', 30) },
    });
    expect(plan.defaultView).toBe('stderr');
  });

  it('reads an unlisted stream as empty — the capturer writes no file for one', () => {
    const plan = resolveTerminalViews({
      ...base,
      metadata: { terminal: record({ artifacts: {} }) },
    });
    expect(plan.views.map((view) => [view.key, view.source.kind])).toEqual([
      ['stdout', 'empty'],
      ['stderr', 'empty'],
      ['transcript', 'inline'],
    ]);
  });

  it('drops both streams for the transcript when one with bytes did not resolve', () => {
    const plan = resolveTerminalViews({
      ...base,
      metadata: { terminal: record({ artifacts: { stderr: artifact(5), stdout: artifact(5) } }) },
      terminalArtifacts: { stdout: link('https://x/stdout') },
    });
    expect(plan.views.map((view) => view.key)).toEqual(['transcript']);
  });

  it('shows merged output from its own file, else from the recording', () => {
    const pty = record({
      artifacts: { cast: artifact(900), output: artifact(40) },
      capture: { mode: 'pty', streamLayout: 'merged', timing: 'recorded' },
    });
    const withOutput = resolveTerminalViews({
      ...base,
      metadata: { terminal: pty },
      terminalArtifacts: { cast: link('https://x/cast'), output: link('https://x/output') },
    });
    expect(withOutput.views[0]).toMatchObject({ key: 'output', source: { kind: 'url' } });
    expect(withOutput.replayUrl).toBe('https://x/cast');

    const castOnly = resolveTerminalViews({
      ...base,
      metadata: { terminal: { ...pty, artifacts: { cast: artifact(900) } } },
      terminalArtifacts: { cast: link('https://x/cast') },
    });
    expect(castOnly.views[0]).toEqual({
      key: 'output',
      plain: true,
      source: { kind: 'cast', url: 'https://x/cast' },
    });
  });

  it('never offers replay without recorded timing, nor for an unresolved recording', () => {
    const imported = record({
      artifacts: { output: artifact(10) },
      capture: { mode: 'import', streamLayout: 'merged', timing: 'unavailable' },
      source: { kind: 'imported' },
    });
    const plan = resolveTerminalViews({
      ...base,
      metadata: { terminal: imported },
      terminalArtifacts: { cast: link('https://x/cast'), output: link('https://x/output') },
    });
    expect(plan.replayUrl).toBeUndefined();

    const recorded = record({
      artifacts: { cast: artifact(900) },
      capture: { mode: 'pty', streamLayout: 'merged', timing: 'recorded' },
    });
    const unresolved = resolveTerminalViews({ ...base, metadata: { terminal: recorded } });
    expect(unresolved.replayUrl).toBeUndefined();
    // Output unknown (the recording did not resolve) — not claimed as empty.
    expect(unresolved.views.map((view) => view.key)).toEqual(['transcript']);
  });
});

describe('terminalFoldTitle', () => {
  it('prefers the command, then the description, then the first transcript line', () => {
    expect(terminalFoldTitle(record(), { description: 'Run tests' })).toBe('pnpm test');
    expect(
      terminalFoldTitle(record({ execution: { command: null } }), { description: ' Run tests ' }),
    ).toBe('Run tests');
    expect(terminalFoldTitle(undefined, { content: '\n$ ls -la\nfoo' })).toBe('ls -la');
    expect(terminalFoldTitle(undefined, {})).toBe('');
  });
});

describe('searchTerminalLines', () => {
  const text = 'PASS a.test\nFAIL b.test\npass c — Pass again\n';

  it('finds every case-insensitive match with its line number and ranges', () => {
    const result = searchTerminalLines(text, 'pass');
    expect(result.matchCount).toBe(3);
    expect(result.matchedLineCount).toBe(2);
    expect(result.lines).toEqual([
      { line: 1, ranges: [[0, 4]], text: 'PASS a.test' },
      {
        line: 3,
        ranges: [
          [0, 4],
          [9, 13],
        ],
        text: 'pass c — Pass again',
      },
    ]);
  });

  it('treats the query literally, not as a pattern', () => {
    expect(searchTerminalLines('a.b\naxb', '.').matchCount).toBe(1);
    expect(searchTerminalLines('[x] done', '[x]').matchCount).toBe(1);
  });

  it('caps listed lines but keeps the full counts', () => {
    const result = searchTerminalLines('x\nx\nx', 'x', 2);
    expect(result.lines).toHaveLength(2);
    expect(result.matchedLineCount).toBe(3);
  });

  it('returns nothing for an empty query', () => {
    expect(searchTerminalLines(text, '')).toEqual({
      lines: [],
      matchCount: 0,
      matchedLineCount: 0,
    });
  });
});

describe('splitTerminalLines', () => {
  it('does not count a trailing newline as a line', () => {
    expect(splitTerminalLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitTerminalLines('a\n\n')).toEqual(['a', '']);
    expect(splitTerminalLines('')).toEqual(['']);
  });
});

describe('terminalReplayError', () => {
  it('keeps a parser failure out of the translated summary and retains it as optional details', () => {
    const message = 'Line 2: event time must be a non-negative number';
    expect(terminalReplayError({ kind: 'invalid', message })).toEqual({
      details: message,
      summaryKey: 'report.terminal.player.unplayable',
    });
  });

  it('preserves the size-limit summary without parser details', () => {
    expect(terminalReplayError({ kind: 'tooLarge' })).toEqual({
      summaryKey: 'report.terminal.player.tooLarge',
    });
  });

  it('uses the load failure summary when no valid recording is available', () => {
    expect(terminalReplayError({ kind: 'failed' })).toEqual({
      summaryKey: 'report.terminal.player.failed',
    });
    expect(terminalReplayError(null)).toEqual({ summaryKey: 'report.terminal.player.failed' });
  });
});
