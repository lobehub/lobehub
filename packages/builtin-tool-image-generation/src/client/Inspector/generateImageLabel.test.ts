import { AsyncTaskStatus } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { GeneratedImageTask } from '../../types';
import { getGenerateImageLabelTense } from './generateImageLabel';

const task = (status: GeneratedImageTask['status']): GeneratedImageTask => ({
  asyncTaskId: 'task',
  generationId: 'gen',
  status,
});

describe('getGenerateImageLabelTense', () => {
  it('uses the progressive tense while arguments stream or the tool runs', () => {
    expect(getGenerateImageLabelTense(true)).toBe('loading');
    expect(getGenerateImageLabelTense(true, { generations: [task(AsyncTaskStatus.Success)] })).toBe(
      'loading',
    );
  });

  it('claims completion only when every image succeeded', () => {
    expect(
      getGenerateImageLabelTense(false, {
        generations: [task(AsyncTaskStatus.Success), task(AsyncTaskStatus.Success)],
      }),
    ).toBe('completed');
  });

  it('does not claim completion while images are still in flight', () => {
    expect(
      getGenerateImageLabelTense(false, {
        generations: [task(AsyncTaskStatus.Success), task(AsyncTaskStatus.Processing)],
      }),
    ).toBe('neutral');
    expect(
      getGenerateImageLabelTense(false, { generations: [task(AsyncTaskStatus.Pending)] }),
    ).toBe('neutral');
  });

  it('does not claim completion when an image failed or nothing was returned', () => {
    expect(
      getGenerateImageLabelTense(false, {
        generations: [task(AsyncTaskStatus.Success), task(AsyncTaskStatus.Error)],
      }),
    ).toBe('neutral');
    expect(getGenerateImageLabelTense(false, { generations: [] })).toBe('neutral');
    expect(getGenerateImageLabelTense(false)).toBe('neutral');
  });
});
