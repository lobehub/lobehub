import type { VerifyTerminalEvidenceMetadata } from '@lobechat/types';

export const HASH = 'a'.repeat(64);

/** A valid captured pipe record for tests; override any top-level section. */
export const terminalRecord = (
  overrides: Partial<VerifyTerminalEvidenceMetadata> = {},
): VerifyTerminalEvidenceMetadata => ({
  artifacts: { stdout: { fileId: 'file_1', sha256: HASH, size: 3 } },
  capture: {
    capturer: { name: 'lh', version: '1.0.0' },
    mode: 'pipe',
    streamLayout: 'separate',
    terminal: null,
    timing: 'unavailable',
  },
  execution: {
    command: 'ls -la',
    cwd: '~/repo',
    durationMs: 12,
    environmentSummary: { platform: 'darwin-arm64' },
    error: null,
    exitCode: 1,
    finishedAt: '2026-10-13T00:00:00.012Z',
    outcome: 'exited',
    signal: null,
    startedAt: '2026-10-13T00:00:00.000Z',
  },
  processing: { missingFields: [], notes: [], redactions: [], truncation: [] },
  source: { kind: 'captured', originalRecordRef: null, originalTool: null },
  version: 1,
  ...overrides,
});
