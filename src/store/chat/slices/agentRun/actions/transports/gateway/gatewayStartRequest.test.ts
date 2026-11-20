import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { readRunStopFailureReason, RunStopUnconfirmedError } from '@/store/chat/utils/runStop';

import { interruptGatewayTaskOrThrow } from './gatewayStartRequest';

vi.mock('@/services/aiAgent', () => ({ aiAgentService: { interruptTask: vi.fn() } }));

describe('interruptGatewayTaskOrThrow', () => {
  beforeEach(() => {
    vi.mocked(aiAgentService.interruptTask).mockReset();
  });

  it('resolves for a confirmed stop', async () => {
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
      deviceCancellationConfirmed: true,
      success: true,
    } as any);

    await expect(interruptGatewayTaskOrThrow({ operationId: 'op-1' })).resolves.toBeUndefined();
  });

  it('resolves for a run the server settled because its runner was gone', async () => {
    // No exit could be confirmed, but the run is over (T-14643).
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
      completionReason: 'runner_disconnected',
      success: true,
    } as any);

    await expect(interruptGatewayTaskOrThrow({ operationId: 'op-1' })).resolves.toBeUndefined();
  });

  it('rejects with the reason the server gave, and forwards force', async () => {
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
      deviceCancellationConfirmed: false,
      failureReason: 'runner_unreachable',
      success: false,
    } as any);

    // A cancel re-run as "Force end" carries `forceStop`.
    const error = await interruptGatewayTaskOrThrow(
      { operationId: 'op-1' },
      { metadata: { forceStop: true } as any },
    ).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(RunStopUnconfirmedError);
    expect(readRunStopFailureReason(error)).toBe('runner_unreachable');
    expect(aiAgentService.interruptTask).toHaveBeenCalledWith({ force: true, operationId: 'op-1' });
  });

  it('still rejects an unconfirmed device exit the server reported as success', async () => {
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({
      deviceCancellationConfirmed: false,
      success: true,
    } as any);

    await expect(interruptGatewayTaskOrThrow({ operationId: 'op-1' })).rejects.toBeInstanceOf(
      RunStopUnconfirmedError,
    );
  });
});
