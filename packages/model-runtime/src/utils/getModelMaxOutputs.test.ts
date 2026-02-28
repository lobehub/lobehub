import  { type AiFullModelCard } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { getModelMaxOutputs } from './getModelMaxOutputs';

describe('getModelMaxOutputs', () => {
  const mockModels: AiFullModelCard[] = [
    {
      id: 'model-1',
      providerId: 'provider-1',
      type: 'chat',
      maxOutput: 1000,
    } as AiFullModelCard,
    {
      id: 'model-2',
      providerId: 'provider-1',
      type: 'chat',
      maxOutput: 2000,
    } as AiFullModelCard,
    {
      id: 'model-3',
      providerId: 'provider-2',
      type: 'chat',
      maxOutput: undefined,
    } as AiFullModelCard,
  ] as AiFullModelCard[];

  it('should return maxOutput for existing model', () => {
    expect(getModelMaxOutputs('model-1', mockModels)).toBe(1000);
    expect(getModelMaxOutputs('model-2', mockModels)).toBe(2000);
  });

  it('should return undefined for model with undefined maxOutput', () => {
    expect(getModelMaxOutputs('model-3', mockModels)).toBeUndefined();
  });

  it('should return undefined for non-existing model', () => {
    expect(getModelMaxOutputs('non-existing', mockModels)).toBeUndefined();
  });

  it('should return undefined for empty models array', () => {
    expect(getModelMaxOutputs('model-1', [])).toBeUndefined();
  });
});
