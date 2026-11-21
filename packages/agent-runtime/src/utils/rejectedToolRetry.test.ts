import type { ChatToolPayload } from '@lobechat/types';
import { formatToolRejectionContent } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildRejectedToolRetryContent, partitionRejectedToolRetries } from './rejectedToolRetry';

const call = (id: string, identifier = 'lobe-local-system', apiName = 'runCommand') =>
  ({ apiName, arguments: '{"command":"ls"}', id, identifier, type: 'builtin' }) as ChatToolPayload;

const rejectedRow = (identifier = 'lobe-local-system', apiName = 'runCommand') => ({
  content: formatToolRejectionContent(),
  plugin: { apiName, identifier },
  pluginIntervention: { status: 'rejected' },
  role: 'tool',
});

const foldedRejection = {
  children: [
    {
      tools: [
        {
          apiName: 'runCommand',
          identifier: 'lobe-local-system',
          intervention: { status: 'rejected' },
          result: { content: 'User reject this tool calling without reason' },
        },
      ],
    },
  ],
  role: 'assistantGroup',
};

describe('partitionRejectedToolRetries', () => {
  it('holds back a rejected tool key in the raw message shape', () => {
    const result = partitionRejectedToolRetries(
      [call('a')],
      [{ role: 'user' }, { role: 'assistant' }, rejectedRow()],
    );
    expect(result.blockedRetries.map(({ id }) => id)).toEqual(['a']);
    expect(result.remainingCalls).toEqual([]);
    expect(result.ignoredBlock).toBe(false);
  });

  it('holds back a rejected tool key in the folded server shape', () => {
    const result = partitionRejectedToolRetries([call('a')], [{ role: 'user' }, foldedRejection]);
    expect(result.blockedRetries).toHaveLength(1);
  });

  it('lets a different tool in the same batch run', () => {
    const result = partitionRejectedToolRetries(
      [call('a'), call('b', 'lobe-web-browsing', 'search')],
      [{ role: 'user' }, rejectedRow()],
    );
    expect(result.blockedRetries.map(({ id }) => id)).toEqual(['a']);
    expect(result.remainingCalls.map(({ id }) => id)).toEqual(['b']);
  });

  it('lifts the block after a new user message', () => {
    const result = partitionRejectedToolRetries(
      [call('a')],
      [{ role: 'user' }, rejectedRow(), { role: 'user' }],
    );
    expect(result.blockedRetries).toEqual([]);
  });

  it('lifts the block after the user answers a question', () => {
    const answered = {
      content: 'use the staging repo',
      plugin: { apiName: 'askUserQuestion', identifier: 'lobe-user-interaction' },
      pluginIntervention: { status: 'approved' },
      role: 'tool',
    };
    const result = partitionRejectedToolRetries(
      [call('a')],
      [{ role: 'user' }, rejectedRow(), answered],
    );
    expect(result.blockedRetries).toEqual([]);
  });

  it('ignores system-blocked and skipped rows', () => {
    const systemBlocked = {
      content: 'Tool execution blocked because the tool is not allowed',
      plugin: { apiName: 'runCommand', identifier: 'lobe-local-system' },
      pluginIntervention: { rejectedReason: 'tool_not_allowed', status: 'rejected' },
      role: 'tool',
    };
    const skipped = {
      ...rejectedRow(),
      pluginIntervention: { skipped: true, status: 'rejected' },
    };
    const result = partitionRejectedToolRetries(
      [call('a')],
      [{ role: 'user' }, systemBlocked, skipped],
    );
    expect(result.blockedRetries).toEqual([]);
  });

  it('does not count a block on another tool as ignored', () => {
    const blockedRow = {
      content: buildRejectedToolRetryContent('lobe-web-browsing/search'),
      role: 'tool',
    };
    const result = partitionRejectedToolRetries(
      [call('a')],
      [{ role: 'user' }, rejectedRow(), blockedRow],
    );
    expect(result.blockedRetries).toHaveLength(1);
    expect(result.ignoredBlock).toBe(false);
  });

  it('reports a model that ignored the block', () => {
    const blockedRow = {
      content: buildRejectedToolRetryContent('lobe-local-system/runCommand'),
      role: 'tool',
    };
    const result = partitionRejectedToolRetries(
      [call('a')],
      [{ role: 'user' }, rejectedRow(), blockedRow],
    );
    expect(result.ignoredBlock).toBe(true);
  });
});
