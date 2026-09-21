import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../../types/error';
import { LobeReplicateAI } from './index';

const predictionsCreate = vi.fn();
const predictionsGet = vi.fn();

vi.mock('replicate', () => ({
  default: vi.fn().mockImplementation(() => ({
    predictions: { create: predictionsCreate, get: predictionsGet },
  })),
}));

describe('LobeReplicateAI video generation', () => {
  let instance: LobeReplicateAI;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new LobeReplicateAI({ apiKey: 'test-token' });
  });

  it('submits a prediction and returns its inferenceId', async () => {
    predictionsCreate.mockResolvedValue({ id: 'pred-42', status: 'starting' });

    const result = await instance.createVideo({
      model: 'prunaai/p-video',
      params: { prompt: 'a lighthouse in a storm' },
    });

    expect(result).toEqual({ inferenceId: 'pred-42' });
    expect(predictionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'prunaai/p-video' }),
    );
  });

  it('polls a prediction and returns the video URL', async () => {
    predictionsGet.mockResolvedValue({ output: 'https://v.mp4', status: 'succeeded' });

    await expect(instance.handlePollVideoStatus('pred-42')).resolves.toEqual({
      status: 'success',
      videoUrl: 'https://v.mp4',
    });
  });

  it('wraps an invalid token into an InvalidProviderAPIKey runtime error', async () => {
    predictionsCreate.mockRejectedValue(new Error('You did not pass a valid API token'));

    await expect(
      instance.createVideo({ model: 'prunaai/p-video', params: { prompt: 'x' } }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey });
  });

  it('wraps an unknown model into a ModelNotFound runtime error', async () => {
    predictionsCreate.mockRejectedValue(new Error('model not found'));

    await expect(
      instance.createVideo({ model: 'nope/nope', params: { prompt: 'x' } }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ModelNotFound });
  });

  it('wraps polling failures into a provider error', async () => {
    predictionsGet.mockRejectedValue(new Error('upstream exploded'));

    await expect(instance.handlePollVideoStatus('pred-42')).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.ProviderBizError,
    });
  });
});
