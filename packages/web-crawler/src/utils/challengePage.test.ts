import { describe, expect, it } from 'vitest';

import { CHALLENGE_PAGE_MAX_LENGTH, isChallengePage } from './challengePage';

describe('isChallengePage', () => {
  it('should detect the Cloudflare interstitial as Jina Reader returns it', () => {
    expect(
      isChallengePage({
        content:
          '![Image 1: Icon for blocked.example.com](https://blocked.example.com/favicon.ico)\n\n## blocked.example.com\n\n## Performing security verification\n\nThis website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot.',
        title: 'Just a moment...',
      }),
    ).toBe(true);
  });

  it('should detect a wall by its title alone', () => {
    const content = 'You do not have permission to access this resource on this server.';

    expect(isChallengePage({ content, title: 'Access Denied' })).toBe(true);
    expect(isChallengePage({ content, title: ' Just a moment… ' })).toBe(true);
    expect(isChallengePage({ content, title: '请稍候…' })).toBe(true);
    expect(isChallengePage({ content, title: 'Access to this page has been denied.' })).toBe(true);
  });

  it('should detect a wall by its body when the provider gives no usable title', () => {
    expect(
      isChallengePage({
        content: 'example.com\n\nVerifying you are human. This may take a few seconds.',
        title: 'example.com',
      }),
    ).toBe(true);
    expect(
      isChallengePage({
        content: 'Sorry, you have been blocked\n\nYou are unable to access example.com',
      }),
    ).toBe(true);
  });

  it('should keep ordinary pages', () => {
    expect(
      isChallengePage({
        content: 'LobeHub is an open-source workspace for agents and teams.',
        title: 'LobeHub',
      }),
    ).toBe(false);
    expect(isChallengePage({ content: '', title: 'Just a moment...' })).toBe(false);
    expect(isChallengePage({ title: 'Just a moment...' })).toBe(false);
  });

  it('should keep a long page that only mentions a challenge', () => {
    const content = `Stuck on "Verifying you are human"? ${'Here is why. '.repeat(400)}`;

    expect(content.length).toBeGreaterThan(CHALLENGE_PAGE_MAX_LENGTH);
    expect(isChallengePage({ content, title: 'Just a moment...' })).toBe(false);
  });

  it('should handle a huge title in linear time', () => {
    // A trailing-anchored regex backtracks quadratically on a long run that does not reach the end
    const title = `${'.'.repeat(200_000)}x`;

    expect(isChallengePage({ content: 'An ordinary page body.', title })).toBe(false);
    expect(
      isChallengePage({ content: 'A page body.', title: `Access Denied${'. '.repeat(1000)}` }),
    ).toBe(true);
  });
});
