import type { ChatErrorDispatchContext } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { renderAgentError } from '../replyTemplate';

const OPERATION_ID = 'op_xxx';

const render = (dispatch: ChatErrorDispatchContext | undefined, lng?: 'en-US' | 'zh-CN') =>
  renderAgentError(
    'ServerAgentRuntimeError',
    'Hetero sandbox spawn failed',
    OPERATION_ID,
    lng,
    undefined,
    undefined,
    undefined,
    dispatch,
  );

describe('fail-fast dispatch IM errors', () => {
  /**
   * ROOT CAUSE (T-1195): a sandbox spawn failure reached the bot as a bare
   * `ServerAgentRuntimeError` with no attribution, so the reply fell to the
   * legacy tier — "Agent Execution Failed" plus an Operation ID — while the
   * actual cause (a missing CLAUDE_CODE_OAUTH_TOKEN) sat only on the message row.
   */
  it('explains a device-access fallback into a sandbox without the credential', () => {
    const reply = render(
      {
        agentType: 'claude-code',
        deviceAccessDenied: true,
        missingCredential: 'CLAUDE_CODE_OAUTH_TOKEN',
        stage: 'sandbox_spawn',
      },
      'zh-CN',
    );

    expect(reply).toBe(
      [
        '**Claude Code 未能在云端沙箱启动**',
        '你没有这台设备的操作权限，已转到云端沙箱运行，但沙箱缺少 `CLAUDE_CODE_OAUTH_TOKEN` 凭证。请让 Bot 所有者在频道的「设备权限」中为你授权，或在「设置 → 凭证管理」中添加 `CLAUDE_CODE_OAUTH_TOKEN`。',
        `Operation ID: \`${OPERATION_ID}\``,
      ].join('\n'),
    );
    expect(reply).not.toContain('Agent Execution Failed');
  });

  it('keeps the Operation ID as the last line, after the cause', () => {
    const lines = render({
      agentType: 'claude-code',
      missingCredential: 'CLAUDE_CODE_OAUTH_TOKEN',
      stage: 'sandbox_spawn',
    }).split('\n');

    expect(lines).toEqual([
      '**Claude Code could not start in the cloud sandbox**',
      'The cloud sandbox is missing the `CLAUDE_CODE_OAUTH_TOKEN` credential. Ask the bot owner to add `CLAUDE_CODE_OAUTH_TOKEN` under Settings → Credentials, then try again.',
      `Operation ID: \`${OPERATION_ID}\``,
    ]);
  });

  it.each([
    ['en-US', true, "You don't have access to this bot's device"],
    ['zh-CN', true, '你没有这台设备的操作权限'],
    ['en-US', false, 'The cloud sandbox failed to start.'],
    ['zh-CN', false, '云端沙箱启动失败。'],
  ] as const)(
    'names the sandbox failure when no credential is known (%s, denied=%s)',
    (lng, deviceAccessDenied, expected) => {
      const reply = render(
        {
          agentType: 'codex',
          ...(deviceAccessDenied && { deviceAccessDenied }),
          stage: 'sandbox_spawn',
        },
        lng,
      );

      expect(reply).toContain('Codex');
      expect(reply).toContain(expected);
      expect(reply).not.toContain('Hetero sandbox spawn failed');
    },
  );

  it('falls back to the legacy reply without a dispatch context', () => {
    expect(render(undefined)).toBe(`**Agent Execution Failed**\nOperation ID: \`${OPERATION_ID}\``);
  });
});
