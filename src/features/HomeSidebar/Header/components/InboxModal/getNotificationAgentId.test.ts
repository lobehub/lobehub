import { describe, expect, it } from 'vitest';

import { getNotificationAgentId } from './getNotificationAgentId';

describe('getNotificationAgentId', () => {
  it('resolves an agent from a personal notification deep link', () => {
    expect(getNotificationAgentId('/agent/agent-1/topic-1')).toBe('agent-1');
  });

  it('resolves an agent from a workspace-prefixed deep link', () => {
    expect(getNotificationAgentId('/acme/agent/agent-2/topic-2?comment=comment-1')).toBe('agent-2');
  });

  it('supports absolute notification links', () => {
    expect(getNotificationAgentId('https://app.lobehub.com/acme/agent/agent-3/topic-3')).toBe(
      'agent-3',
    );
  });

  it.each([undefined, null, '/image?topic=topic-1', '/agent', '/system'])(
    'returns undefined for a non-agent action URL: %s',
    (actionUrl) => {
      expect(getNotificationAgentId(actionUrl)).toBeUndefined();
    },
  );

  it('returns undefined when the encoded agent id is malformed', () => {
    expect(getNotificationAgentId('/agent/%E0%A4%A/topic-1')).toBeUndefined();
  });
});
