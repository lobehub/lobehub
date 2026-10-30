import { describe, expect, it } from 'vitest';

import { checkOrigins, originErrorFromServer, reviewLink, siteSnippet } from './siteSnippet';

describe('siteSnippet', () => {
  it('omits the server for LobeHub cloud', () => {
    expect(siteSnippet('psite_7f3k9q2mAbCd', 'https://app.lobehub.com')).toBe(
      '<script src="https://web-assets.lobehub.com/review-sdk/assets/v1/lobehub-review.js" data-site="psite_7f3k9q2mAbCd"></script>',
    );
  });

  it('names a self-hosted server', () => {
    expect(siteSnippet('psite_7f3k9q2mAbCd', 'http://localhost:3010')).toContain(
      'data-site="psite_7f3k9q2mAbCd" data-server="http://localhost:3010"',
    );
  });

  it('escapes attribute values so they cannot break out of the tag', () => {
    expect(siteSnippet('a"><img src=x>', 'http://h/"&\'')).toBe(
      '<script src="https://web-assets.lobehub.com/review-sdk/assets/v1/lobehub-review.js" data-site="a&quot;&gt;&lt;img src=x&gt;" data-server="http://h/&quot;&amp;&#39;"></script>',
    );
  });
});

describe('reviewLink', () => {
  it('opens the first exact origin with the activation parameter', () => {
    expect(reviewLink(['https://*.fieldnotes.app', 'https://fieldnotes.app'], 'acc_1')).toBe(
      'https://fieldnotes.app/?lh-acceptance=acc_1',
    );
  });

  it('escapes the acceptance id instead of appending it raw', () => {
    expect(reviewLink(['https://fieldnotes.app'], 'acc&next=1')).toBe(
      'https://fieldnotes.app/?lh-acceptance=acc%26next%3D1',
    );
  });

  it('leaves the site unreachable for review without an acceptance', () => {
    expect(reviewLink(['https://fieldnotes.app'])).toBeNull();
    expect(reviewLink(['https://fieldnotes.app'], null)).toBeNull();
  });

  it('has nothing to open when every origin is a wildcard', () => {
    expect(reviewLink(['https://*.fieldnotes.app'], 'acc_1')).toBeNull();
  });

  it('refuses an origin that is not an http URL instead of throwing', () => {
    expect(reviewLink(['fieldnotes.app'], 'acc_1')).toBeNull();
    expect(reviewLink(['javascript:alert(1)'], 'acc_1')).toBeNull();
  });
});

describe('checkOrigins', () => {
  it('reports each invalid origin by position and ignores blank rows', () => {
    expect(
      checkOrigins([
        'https://fieldnotes.app',
        '',
        'https://*.vercel.app',
        'http://192.168.1.5:3000',
      ]),
    ).toEqual([undefined, undefined, 'sharedHostWildcard', 'insecure']);
  });
});

describe('originErrorFromServer', () => {
  it('reads the index and reason from a rejected save', () => {
    expect(originErrorFromServer(new Error('invalidOrigin:2:path'))).toEqual({
      index: 2,
      reason: 'path',
    });
    expect(originErrorFromServer(new Error('Cannot manage review access'))).toBeUndefined();
  });
});
