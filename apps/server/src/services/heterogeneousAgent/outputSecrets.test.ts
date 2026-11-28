// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fingerprintSecret, REDACTED_SECRET, redactOutputSecrets } from './outputSecrets';

const OAUTH = `sk-ant-oat01-${'a'.repeat(40)}_-Xy`;
const API_KEY = `sk-ant-api03-${'B'.repeat(60)}`;

describe('redactOutputSecrets', () => {
  it('redacts credentials anywhere in the events and reports each once', () => {
    const events = [
      {
        data: { content: `CLAUDE_CODE_OAUTH_TOKEN=${OAUTH}\nHOME=/home/u` },
        stepIndex: 1,
        type: 'tool_result',
      },
      { data: { args: { command: `echo ${OAUTH} ${API_KEY}` } }, stepIndex: 2, type: 'tool_start' },
    ];

    const { events: redacted, secrets } = redactOutputSecrets(events);

    expect(JSON.stringify(redacted)).not.toContain('sk-ant-');
    expect(redacted[0].data.content).toBe(
      `CLAUDE_CODE_OAUTH_TOKEN=${REDACTED_SECRET}\nHOME=/home/u`,
    );
    expect(redacted[1].stepIndex).toBe(2);
    expect(secrets).toEqual([
      { fingerprint: fingerprintSecret(OAUTH), kind: 'anthropic-oauth-token' },
      { fingerprint: fingerprintSecret(API_KEY), kind: 'anthropic-api-key' },
    ]);
  });

  it('returns a batch without credentials untouched', () => {
    const events = [{ data: { content: 'sk-ant- is a prefix, not a key' }, type: 'text' }];
    const result = redactOutputSecrets(events);
    expect(result.events).toBe(events);
    expect(result.secrets).toEqual([]);
  });

  it('fingerprints without revealing the secret', () => {
    const fingerprint = fingerprintSecret(OAUTH);
    expect(fingerprint).toMatch(/^[\da-f]{16}$/);
    expect(OAUTH).not.toContain(fingerprint);
  });
});
