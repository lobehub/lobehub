import { describe, expect, it } from 'vitest';

import { parseGithubRepository } from './githubRepository';

describe('parseGithubRepository', () => {
  const expected = {
    fullName: 'lobehub/lobe-chat',
    name: 'lobe-chat',
    url: 'https://github.com/lobehub/lobe-chat',
  };

  it.each([
    'https://github.com/lobehub/lobe-chat',
    'https://github.com/lobehub/lobe-chat.git',
    'https://github.com/lobehub/lobe-chat/',
    '  https://github.com/lobehub/lobe-chat  ',
    'git@github.com:lobehub/lobe-chat.git',
    'lobehub/lobe-chat',
  ])('reads %s', (value) => {
    expect(parseGithubRepository(value)).toEqual(expected);
  });

  it.each([
    '',
    'lobe-chat',
    'http://github.com/lobehub/lobe-chat',
    'https://gitlab.com/lobehub/lobe-chat',
    'https://token@github.com/lobehub/lobe-chat',
    'https://github.com/lobehub/lobe-chat/tree/main',
    'https://github.com/lobehub/lobe-chat?tab=readme',
    'https://github.com/lobehub',
    'not a url',
  ])('rejects %s', (value) => {
    expect(parseGithubRepository(value)).toBeNull();
  });
});
