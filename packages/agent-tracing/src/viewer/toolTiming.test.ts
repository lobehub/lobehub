import { describe, expect, it } from 'vitest';

import type { ExecutionSnapshot, StepSnapshot } from '../types';
import { renderSnapshot } from './index';

const toolStep = (toolsResult: NonNullable<StepSnapshot['toolsResult']>): StepSnapshot => ({
  completedAt: 3_000,
  executionTimeMs: 2_000,
  startedAt: 1_000,
  stepIndex: 0,
  stepType: 'call_tool',
  toolsResult,
  totalCost: 0,
  totalTokens: 0,
});

const snapshotWith = (step: StepSnapshot): ExecutionSnapshot => ({
  operationId: 'op_1',
  startedAt: 1_000,
  steps: [step],
  totalCost: 0,
  totalSteps: 1,
  totalTokens: 0,
  traceId: 'op_1',
});

// The renderer colourises; assertions read the text with escapes stripped.
const plain = (s: string) => s.replaceAll(/\x1B\[\d+m/g, '');

describe('tool timing in the trace viewer', () => {
  it('splits a device call into work and transport', () => {
    const out = plain(
      renderSnapshot(
        snapshotWith(
          toolStep([
            {
              apiName: 'readFile',
              deviceExecutionTimeMs: 40,
              executionTimeMs: 1_950,
              identifier: 'local-system',
              isSuccess: true,
            },
          ]),
        ),
      ),
    );

    // 1950 observed − 40 on the device = 1.9s that was pure dispatch.
    expect(out).toContain('1.9s (device 40ms + transport 1.9s)');
  });

  it('shows the total alone when the device reported nothing', () => {
    const out = plain(
      renderSnapshot(
        snapshotWith(
          toolStep([
            { apiName: 'search', executionTimeMs: 320, identifier: 'web', isSuccess: true },
          ]),
        ),
      ),
    );

    expect(out).toContain('320ms');
    expect(out).not.toContain('transport');
  });

  it('never reports negative transport when the clocks disagree', () => {
    // Two machines, two clocks: the device can report marginally more than the
    // server observed. Clamp rather than print a negative.
    const out = plain(
      renderSnapshot(
        snapshotWith(
          toolStep([
            {
              apiName: 'noop',
              deviceExecutionTimeMs: 105,
              executionTimeMs: 100,
              identifier: 'local-system',
              isSuccess: true,
            },
          ]),
        ),
      ),
    );

    expect(out).toContain('transport 0ms');
  });

  it('omits timing entirely for a step that recorded none', () => {
    const out = plain(
      renderSnapshot(
        snapshotWith(toolStep([{ apiName: 'x', identifier: 'y', isSuccess: true }])),
      ),
    );

    expect(out).toContain('Tool  y  ');
    expect(out).not.toContain('device');
  });
});
