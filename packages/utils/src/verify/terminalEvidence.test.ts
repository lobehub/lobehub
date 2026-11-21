import { describe, expect, it } from 'vitest';

import {
  createTerminalSanitizer,
  describeTerminalOutcome,
  formatTerminalTranscript,
  isExecutionEvidence,
  parseTerminalEvidenceMetadata,
  readTerminalEvidenceMetadata,
  terminalTextFromStream,
} from './terminalEvidence';
import { HASH, terminalRecord } from './terminalEvidence.fixture';

describe('parseTerminalEvidenceMetadata', () => {
  it('accepts a complete record and normalizes optional fields', () => {
    const parsed = parseTerminalEvidenceMetadata(terminalRecord());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.metadata.artifacts.cast).toBeNull();
  });

  it.each([
    ['a wrong version', { version: 2 }],
    ['an unknown source kind', { source: { kind: 'verified' } }],
    [
      'recorded timing without a recording',
      {
        capture: { mode: 'pty', streamLayout: 'merged', timing: 'recorded' },
      },
    ],
    [
      'a recording without recorded timing',
      {
        artifacts: { cast: { sha256: HASH, size: 1 } },
      },
    ],
    [
      'a captured source in import mode',
      { capture: { mode: 'import', streamLayout: 'merged', timing: 'unavailable' } },
    ],
    ['an import that claims a pipe capture', { source: { kind: 'imported' } }],
    [
      'an absolute artifact path',
      { artifacts: { stdout: { path: '/etc/passwd', sha256: HASH, size: 1 } } },
    ],
    [
      'an escaping artifact path',
      { artifacts: { stdout: { path: '../x', sha256: HASH, size: 1 } } },
    ],
    ['a malformed hash', { artifacts: { stdout: { sha256: 'abc', size: 1 } } }],
    [
      'a non-ISO start time',
      { execution: { ...terminalRecord().execution, startedAt: 'yesterday' } },
    ],
  ])('refuses %s', (_, overrides) => {
    const parsed = parseTerminalEvidenceMetadata({ ...terminalRecord(), ...overrides });
    expect(parsed.ok).toBe(false);
  });

  it('names the offending field', () => {
    const parsed = parseTerminalEvidenceMetadata({
      ...terminalRecord(),
      execution: { ...terminalRecord().execution, exitCode: 'zero' },
    });
    expect(parsed).toEqual({
      error: 'terminal.execution.exitCode must be an integer or null',
      ok: false,
    });
  });
});

describe('isExecutionEvidence', () => {
  it('counts captured and imported terminal evidence only', () => {
    const imported = terminalRecord({
      capture: { ...terminalRecord().capture, mode: 'import' },
      source: { kind: 'imported' },
    });
    const authored = terminalRecord({
      capture: { ...terminalRecord().capture, mode: 'import' },
      source: { kind: 'authored' },
    });
    expect(
      isExecutionEvidence({ metadata: { terminal: terminalRecord() }, type: 'terminal' }),
    ).toBe(true);
    expect(isExecutionEvidence({ metadata: { terminal: imported }, type: 'terminal' })).toBe(true);
    expect(isExecutionEvidence({ metadata: { terminal: authored }, type: 'terminal' })).toBe(false);
    // A terminal record on a text row, or a broken record, is not provenance.
    expect(isExecutionEvidence({ metadata: { terminal: terminalRecord() }, type: 'text' })).toBe(
      false,
    );
    expect(isExecutionEvidence({ metadata: { terminal: { version: 1 } }, type: 'terminal' })).toBe(
      false,
    );
    expect(isExecutionEvidence({ type: 'terminal' })).toBe(false);
  });

  it('reads the record only from metadata.terminal', () => {
    expect(readTerminalEvidenceMetadata(terminalRecord())).toBeUndefined();
    expect(readTerminalEvidenceMetadata({ terminal: terminalRecord() })?.execution.command).toBe(
      'ls -la',
    );
  });
});

describe('createTerminalSanitizer', () => {
  it('drops hyperlinks, clipboard writes and other string sequences but keeps drawing', () => {
    const clean = createTerminalSanitizer();
    expect(
      clean(
        '\u001B[31mred\u001B[0m \u001B]8;;https://evil.example\u001B\\link\u001B]8;;\u001B\\ \u001B]52;c;Y2xpcA==\u0007done\u001BPq#0;2;0;0;0\u001B\\!',
      ),
    ).toBe('\u001B[31mred\u001B[0m link done!');
  });

  it('removes a sequence split across chunks', () => {
    const clean = createTerminalSanitizer();
    expect(clean('a\u001B]52;c;')).toBe('a');
    expect(clean('Y2xp\u0007b')).toBe('b');
    expect(clean('\u001B')).toBe('');
    expect(clean(']0;title\u0007c')).toBe('c');
  });

  it('handles C1 introducers and keeps a lone escape before another', () => {
    expect(createTerminalSanitizer()('x\u009D8;;u\u009Cy')).toBe('xy');
    expect(createTerminalSanitizer()('\u001B\u001B[1mz')).toBe('\u001B\u001B[1mz');
  });
});

describe('terminalTextFromStream', () => {
  it('strips control sequences and keeps the last carriage-return write of a line', () => {
    expect(
      terminalTextFromStream(
        '\u001B[1;32mok\u001B[0m\r\nprogress 10%\rprogress 90%\r\n\u001B]0;t\u0007end\r',
      ),
    ).toBe('ok\nprogress 90%\nend');
  });
});

describe('formatTerminalTranscript', () => {
  it('lists the facts, then each stream verbatim as plain text', () => {
    const text = formatTerminalTranscript(
      terminalRecord({
        processing: {
          missingFields: [],
          notes: ['n'],
          redactions: [{ count: 2, rule: 'env-secret' }],
          truncation: [{ droppedBytes: 2048, keptBytes: 10, stream: 'stdout' }],
        },
      }),
      { stderr: '', stdout: '\u001B[32mout\u001B[0m\n' },
    );
    expect(text).toBe(
      [
        '$ ls -la',
        '# cwd: ~/repo',
        '# source: captured · mode: pipe · no timing',
        '# result: exit 1 · started 2026-10-13T00:00:00.000Z · 0.01s',
        '# env: platform=darwin-arm64',
        '# redacted: env-secret ×2',
        '# truncated: stdout kept 10 B, dropped 2.0 KiB',
        '# note: n',
        '',
        '--- stdout ---',
        'out',
        '',
        '--- stderr (empty) ---',
        '',
      ].join('\n'),
    );
  });

  it('says what is unknown instead of guessing', () => {
    expect(
      describeTerminalOutcome({
        ...terminalRecord().execution,
        exitCode: null,
        outcome: 'unknown',
      }),
    ).toBe('exit status unknown');
    expect(
      describeTerminalOutcome({
        ...terminalRecord().execution,
        outcome: 'timed_out',
        signal: 'SIGTERM',
      }),
    ).toBe('timed out, killed by SIGTERM');
  });
});
