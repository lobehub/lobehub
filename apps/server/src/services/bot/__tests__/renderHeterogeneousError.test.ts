import { HETERO_ERROR_SPECS } from '@lobechat/heterogeneous-agents/errors';
import { describe, expect, it } from 'vitest';

import { renderAgentError } from '../replyTemplate';

describe('heterogeneous IM errors', () => {
  it.each(Object.values(HETERO_ERROR_SPECS))(
    'renders known kind $kind with its H reference',
    (spec) => {
      for (const lng of ['en-US', 'zh-CN'] as const) {
        const reply = renderAgentError(
          'AgentRuntimeError',
          'secret CLI stderr',
          'op-test',
          lng,
          'harness',
          undefined,
          {
            agentType: 'claude-code',
            kind: spec.kind,
            rateLimitType: 'seven_day',
            resetsAt: 1789826400,
          },
        );
        expect(reply).toContain(`H${spec.numericId}`);
        expect(reply).toContain('op-test');
        expect(reply).not.toContain('secret CLI stderr');
        expect(reply).not.toContain('undefined');
        expect(reply).not.toContain('{{');
        if (spec.kind !== 'usage_limit') expect(reply).not.toContain('2026-09-19');
      }
    },
  );
  it('renders a weekly quota reset instead of an internal-error retry prompt', () => {
    const reply = renderAgentError(
      'AgentRuntimeError',
      undefined,
      'op-quota',
      'zh-CN',
      'harness',
      undefined,
      {
        agentType: 'claude-code',
        kind: 'usage_limit',
        rateLimitType: 'seven_day',
        resetsAt: 1789826400,
      },
    );
    expect(reply).toContain('本周额度已用完');
    expect(reply).toContain('2026-09-19 14:00');
    expect(reply).toContain('UTC');
    expect(reply).not.toContain('E8001');
  });
});
