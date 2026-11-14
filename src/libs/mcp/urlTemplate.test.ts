import { describe, expect, it } from 'vitest';

import { renderMcpArgs, renderMcpUrlTemplate } from './urlTemplate';

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

  it('fills the `{{config.KEY}}` placeholders Market listings use', () => {
    expect(
      renderMcpUrlTemplate('https://x.dev/mcp?key={{config.API_KEY}}', { API_KEY: 'k 1' }),
    ).toEqual({ url: 'https://x.dev/mcp?key=k%201', usedKeys: ['API_KEY'] });
  });
});

describe('renderMcpArgs', () => {
  it('fills placeholders in stdio args with the raw config values', () => {
    expect(
      renderMcpArgs(['-y', 'pkg', 'API_KEY={{config.API_KEY}}', '--team={{team}}'], {
        API_KEY: 'a&b c',
        team: 'core',
      }),
    ).toEqual(['-y', 'pkg', 'API_KEY=a&b c', '--team=core']);
  });

  it('leaves args without a value or without config untouched', () => {
    expect(renderMcpArgs(['--key={{config.KEY}}'], { KEY: '' })).toEqual(['--key={{config.KEY}}']);
    expect(renderMcpArgs(['--key={{config.KEY}}'])).toEqual(['--key={{config.KEY}}']);
    expect(renderMcpArgs(undefined, { KEY: 'v' })).toBeUndefined();
  });
});
