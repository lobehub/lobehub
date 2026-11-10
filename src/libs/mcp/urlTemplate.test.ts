import { describe, expect, it } from 'vitest';

import { renderMcpUrlTemplate } from './urlTemplate';

describe('renderMcpUrlTemplate', () => {
  it('fills placeholders with URL-encoded config values and reports the keys it used', () => {
    expect(
      renderMcpUrlTemplate('https://api.example.com/mcp?apikey={{API_KEY}}&region={{ region }}', {
        API_KEY: 'a&b=c d',
        region: 'eu',
        X_TRACE: 'kept',
      }),
    ).toEqual({
      url: 'https://api.example.com/mcp?apikey=a%26b%3Dc%20d&region=eu',
      usedKeys: ['API_KEY', 'region'],
    });
  });

  it('fills path segments too', () => {
    expect(
      renderMcpUrlTemplate('https://{{host}}.example.com/{{team}}/mcp', { team: 'a/b' }),
    ).toEqual({
      url: 'https://{{host}}.example.com/a%2Fb/mcp',
      usedKeys: ['team'],
    });
  });

  it('leaves placeholders without a value and URLs without placeholders untouched', () => {
    expect(renderMcpUrlTemplate('https://x.dev/mcp?k={{KEY}}', { KEY: '' })).toEqual({
      url: 'https://x.dev/mcp?k={{KEY}}',
      usedKeys: [],
    });
    expect(renderMcpUrlTemplate('https://x.dev/mcp', { KEY: 'v' })).toEqual({
      url: 'https://x.dev/mcp',
      usedKeys: [],
    });
    expect(renderMcpUrlTemplate('https://x.dev/mcp?k={{KEY}}')).toEqual({
      url: 'https://x.dev/mcp?k={{KEY}}',
      usedKeys: [],
    });
  });
});
