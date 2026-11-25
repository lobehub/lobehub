import { describe, expect, it } from 'vitest';

import { orderRunners, parseRepositoryArg, SANDBOX_RUNNER_ID } from './projectRunner';

const folder = (id: string, sortOrder = 0) => ({ id, path: `/work/${id}`, sortOrder });

describe('orderRunners', () => {
  it('puts device folders before the sandbox on a tie, in their own order', () => {
    expect(orderRunners([folder('a'), folder('b')], 0).map((r) => r.id)).toEqual([
      'a',
      'b',
      SANDBOX_RUNNER_ID,
    ]);
  });

  it('follows a sandbox moved ahead of the folders', () => {
    expect(orderRunners([folder('a', 1)], -1).map((r) => r.id)).toEqual([SANDBOX_RUNNER_ID, 'a']);
  });
});

describe('parseRepositoryArg', () => {
  it('reads a branch after the last @', () => {
    expect(parseRepositoryArg('https://github.com/lobehub/lobe-pet@main')).toEqual({
      ref: 'main',
      url: 'https://github.com/lobehub/lobe-pet',
    });
  });

  it('keeps an ssh url whole when it has no ref', () => {
    expect(parseRepositoryArg('git@github.com:lobehub/lobe-pet.git')).toEqual({
      url: 'git@github.com:lobehub/lobe-pet.git',
    });
  });

  it('leaves a plain url without a ref', () => {
    expect(parseRepositoryArg('https://github.com/lobehub/lobe-pet')).toEqual({
      url: 'https://github.com/lobehub/lobe-pet',
    });
  });
});
