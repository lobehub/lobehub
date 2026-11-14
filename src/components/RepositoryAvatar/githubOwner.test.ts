import { describe, expect, it } from 'vitest';

import { githubOwner } from './index';

describe('githubOwner', () => {
  it('reads the owner of every form an environment names its repository in', () => {
    expect(githubOwner('https://github.com/lobehub-biz/agent-mail')).toBe('lobehub-biz');
    expect(githubOwner('git@github.com:lobehub/lobehub.git')).toBe('lobehub');
    expect(githubOwner('lobehub/lobe-tts')).toBe('lobehub');
  });

  it('names no owner for anything else', () => {
    expect(githubOwner(undefined)).toBeUndefined();
    expect(githubOwner('https://gitlab.com/a/b')).toBeUndefined();
    expect(githubOwner('agent-mail')).toBeUndefined();
  });
});
