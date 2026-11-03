import { describe, expect, it } from 'vitest';

import { AcpRpcResponseError } from './acpStdioClient';
import {
  buildCopilotAcpArgs,
  isCopilotAcpSessionNotFoundError,
  parseCopilotAcpModelCatalog,
} from './copilotAcpSession';

describe('Copilot ACP helpers', () => {
  it('prepends --acp --stdio while stripping session-level model/effort flags and duplicated ACP flags', () => {
    expect(
      buildCopilotAcpArgs([
        '--acp',
        '--stdio',
        '--model',
        'gpt-5.4',
        '--reasoning-effort',
        'high',
        '--allow-all-tools',
      ]),
    ).toEqual(['--acp', '--stdio', '--allow-all-tools']);
  });

  it('parses models from ACP session/new response', () => {
    expect(
      parseCopilotAcpModelCatalog({
        configOptions: [
          {
            category: 'model',
            currentValue: 'claude-sonnet-4.6',
            id: 'model',
            options: [
              {
                description: 'Claude Sonnet 4.6 (1x)',
                name: 'Claude Sonnet 4.6',
                value: 'claude-sonnet-4.6',
              },
              {
                description: 'GPT-5.4 (1x)',
                name: 'GPT-5.4',
                value: 'gpt-5.4',
              },
            ],
          },
        ],
        models: {
          availableModels: [
            {
              description: 'Claude Sonnet 4.6 (1x)',
              modelId: 'claude-sonnet-4.6',
              name: 'Claude Sonnet 4.6',
            },
            {
              description: 'GPT-5.4 (1x)',
              modelId: 'gpt-5.4',
              name: 'GPT-5.4',
            },
          ],
          currentModelId: 'claude-sonnet-4.6',
        },
        sessionId: 'copilot-session-1',
      }),
    ).toEqual({
      configId: 'model',
      currentModelId: 'claude-sonnet-4.6',
      models: [
        {
          id: 'claude-sonnet-4.6',
          label: 'Claude Sonnet 4.6',
          modelId: 'claude-sonnet-4.6',
          providerId: 'copilot',
        },
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          modelId: 'gpt-5.4',
          providerId: 'copilot',
        },
      ],
    });
  });

  it('recognizes Copilot session-not-found RPC errors', () => {
    expect(
      isCopilotAcpSessionNotFoundError(
        new AcpRpcResponseError('session/load', {
          code: -32_603,
          data: { details: 'Session missing-id not found' },
          message: 'Internal error',
        }),
      ),
    ).toBe(true);

    expect(
      isCopilotAcpSessionNotFoundError(
        new AcpRpcResponseError('session/load', {
          code: -32_603,
          data: { details: 'Authentication required' },
          message: 'Internal error',
        }),
      ),
    ).toBe(false);
  });
});
