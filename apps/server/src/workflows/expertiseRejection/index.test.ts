// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExpertiseRejectionWorkflow } from './index';

const { appEnv, ingestAcceptanceRound, workflowClient } = vi.hoisted(() => ({
  appEnv: { APP_URL: 'https://app.test', enableQueueAgentRuntime: false, INTERNAL_APP_URL: '' },
  ingestAcceptanceRound: vi.fn(),
  workflowClient: { trigger: vi.fn() },
}));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/envs/app', () => ({ appEnv }));
vi.mock('@/libs/qstash', () => ({ workflowClient }));
vi.mock('@/server/services/expertise/ingestion', () => ({
  ExpertiseIngestionService: class {
    ingestAcceptanceRound = ingestAcceptanceRound;
  },
}));

const settle = (verifyRunId: string, userId = 'user-1') =>
  ExpertiseRejectionWorkflow.trigger({ acceptanceId: 'acc-1', userId, verifyRunId });

/** Resolves once every microtask queued by the triggers has run. */
const drain = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

afterEach(() => {
  vi.clearAllMocks();
  appEnv.enableQueueAgentRuntime = false;
});

describe('ExpertiseRejectionWorkflow.trigger without a queue', () => {
  it('runs one reviewer’s rounds one at a time', async () => {
    let running = 0;
    let overlapped = false;
    const release: (() => void)[] = [];
    ingestAcceptanceRound.mockImplementation(() => {
      running += 1;
      if (running > 1) overlapped = true;
      return new Promise((resolve) =>
        release.push(() => {
          running -= 1;
          resolve({});
        }),
      );
    });

    await settle('run-1');
    await settle('run-2');
    await drain();

    // Both rounds would otherwise read the lesson catalog before either writes, and fork a lesson
    // that should have attached.
    expect(ingestAcceptanceRound).toHaveBeenCalledTimes(1);
    release[0]();
    await drain();
    expect(ingestAcceptanceRound).toHaveBeenCalledTimes(2);
    expect(overlapped).toBe(false);
    release[1]();
    await drain();
  });

  it('keeps the rounds queued behind a failed one', async () => {
    ingestAcceptanceRound.mockRejectedValueOnce(new Error('provider down')).mockResolvedValue({});

    await settle('run-1');
    await drain();
    await settle('run-2');
    await drain();

    expect(ingestAcceptanceRound).toHaveBeenCalledTimes(2);
  });

  it('does not serialize across reviewers', async () => {
    ingestAcceptanceRound.mockReturnValue(new Promise(() => {}));

    await settle('run-1', 'user-1');
    await settle('run-2', 'user-2');
    await drain();

    expect(ingestAcceptanceRound).toHaveBeenCalledTimes(2);
  });

  it('hands off to the queue when one is configured, without running locally', async () => {
    appEnv.enableQueueAgentRuntime = true;

    await settle('run-1');
    await drain();

    expect(ingestAcceptanceRound).not.toHaveBeenCalled();
    expect(workflowClient.trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        flowControl: { key: 'expertise-rejection.user-1', parallelism: 1 },
      }),
    );
  });
});
