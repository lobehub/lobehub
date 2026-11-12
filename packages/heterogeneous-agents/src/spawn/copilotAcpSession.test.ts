import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcpRpcResponseError } from './acpStdioClient';
import {
  buildCopilotAcpArgs,
  CopilotAcpSession,
  isCopilotAcpSessionNotFoundError,
  parseCopilotAcpModelCatalog,
} from './copilotAcpSession';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

describe('Copilot ACP helpers', () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

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
    ).toEqual(['--acp', '--stdio', '--allow-all-tools', '--allow-all']);
  });

  it.each(['--allow-all', '--yolo'])('does not duplicate an explicit %s flag', (flag) => {
    expect(buildCopilotAcpArgs([flag])).toEqual(['--acp', '--stdio', flag]);
  });

  it('spawns the ACP process with full access to match the other local agents', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn captured');
    });

    const session = new CopilotAcpSession({
      commandPath: 'copilot',
      cwd: '/tmp',
      onEvents: async () => {},
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-full-access',
      prompt: 'hello',
      sessionId: 'session-full-access',
    });

    await session.run().catch(() => {});

    expect(spawnMock).toHaveBeenCalledWith(
      'copilot',
      ['--acp', '--stdio', '--allow-all'],
      expect.anything(),
    );
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

  it('applies initialModel on resume even when discovery session defaults to the same model', async () => {
    const requests: Array<{
      id?: number | string;
      method?: string;
      params?: Record<string, unknown>;
    }> = [];
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const send = (message: Record<string, unknown>) =>
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

      Object.assign(child, {
        kill: vi.fn(() => true),
        killed: false,
        pid: 123_456,
        stderr,
        stdin: {
          once: vi.fn(),
          write: vi.fn((chunk: string) => {
            const msg = JSON.parse(chunk.trim()) as {
              id?: number | string;
              method?: string;
              params?: Record<string, unknown>;
            };
            requests.push(msg);
            queueMicrotask(() => {
              switch (msg.method) {
                case 'initialize': {
                  send({
                    id: msg.id,
                    result: { agentCapabilities: { loadSession: true }, protocolVersion: 1 },
                  });
                  return;
                }
                case 'session/load': {
                  send({ id: msg.id, result: {} });
                  return;
                }
                case 'session/new': {
                  send({
                    id: msg.id,
                    result: {
                      configOptions: [
                        {
                          category: 'model',
                          currentValue: 'auto',
                          id: 'model',
                          options: [
                            { name: 'Auto', value: 'auto' },
                            { name: 'GPT-5.4', value: 'gpt-5.4' },
                          ],
                        },
                      ],
                      sessionId: 'discovery-session',
                    },
                  });
                  return;
                }
                case 'session/set_config_option': {
                  send({
                    id: msg.id,
                    result: {
                      configOptions: [
                        {
                          category: 'model',
                          currentValue: msg.params?.value,
                          id: 'model',
                        },
                      ],
                    },
                  });
                  return;
                }
                case 'session/prompt': {
                  send({ id: msg.id, result: { stopReason: 'end_turn' } });
                  return;
                }
              }
            });
            return true;
          }),
        },
        stdout,
      });
      return child;
    });

    const models: string[] = [];
    const session = new CopilotAcpSession({
      commandPath: 'copilot',
      cwd: '/tmp',
      initialModel: 'auto',
      onEvents: async () => {},
      onModel: (model) => models.push(model),
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-1',
      prompt: 'hello',
      resumeSessionId: 'resumed-session-1',
      sessionId: 'session-1',
    });

    await session.run();

    const setModelCall = requests.find(
      (req) =>
        req.method === 'session/set_config_option' &&
        req.params?.configId === 'model' &&
        req.params?.sessionId === 'resumed-session-1',
    );
    expect(setModelCall?.params).toEqual({
      configId: 'model',
      sessionId: 'resumed-session-1',
      value: 'auto',
    });
    expect(models).toEqual(['auto']);
  });

  it('applies reasoningEffort on resume without initialModel when session/load omits configOptions', async () => {
    const requests: Array<{
      id?: number | string;
      method?: string;
      params?: Record<string, unknown>;
    }> = [];
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as ChildProcess;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const send = (message: Record<string, unknown>) =>
        stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

      Object.assign(child, {
        kill: vi.fn(() => true),
        killed: false,
        pid: 123_456,
        stderr,
        stdin: {
          once: vi.fn(),
          write: vi.fn((chunk: string) => {
            const msg = JSON.parse(chunk.trim()) as {
              id?: number | string;
              method?: string;
              params?: Record<string, unknown>;
            };
            requests.push(msg);
            queueMicrotask(() => {
              switch (msg.method) {
                case 'initialize': {
                  send({
                    id: msg.id,
                    result: { agentCapabilities: { loadSession: true }, protocolVersion: 1 },
                  });
                  return;
                }
                case 'session/load': {
                  send({ id: msg.id, result: {} });
                  return;
                }
                case 'session/new': {
                  send({
                    id: msg.id,
                    result: {
                      configOptions: [
                        {
                          category: 'model',
                          currentValue: 'gpt-5.4',
                          id: 'model',
                          options: [
                            { name: 'Auto', value: 'auto' },
                            { name: 'GPT-5.4', value: 'gpt-5.4' },
                          ],
                        },
                        {
                          category: 'thought_level',
                          currentValue: 'high',
                          id: 'reasoning_effort',
                          options: [
                            { name: 'Low', value: 'low' },
                            { name: 'Medium', value: 'medium' },
                            { name: 'High', value: 'high' },
                          ],
                        },
                      ],
                      sessionId: 'discovery-session',
                    },
                  });
                  return;
                }
                case 'session/set_config_option': {
                  send({
                    id: msg.id,
                    result: {
                      configOptions: [
                        {
                          category: 'thought_level',
                          currentValue: msg.params?.value,
                          id: 'reasoning_effort',
                        },
                      ],
                    },
                  });
                  return;
                }
                case 'session/prompt': {
                  send({ id: msg.id, result: { stopReason: 'end_turn' } });
                  return;
                }
              }
            });
            return true;
          }),
        },
        stdout,
      });
      return child;
    });

    const session = new CopilotAcpSession({
      commandPath: 'copilot',
      cwd: '/tmp',
      onEvents: async () => {},
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      onStderr: () => {},
      operationId: 'op-2',
      prompt: 'hello',
      reasoningEffort: 'high',
      resumeSessionId: 'resumed-session-2',
      sessionId: 'session-2',
    });

    await session.run();

    const setEffortCall = requests.find(
      (req) =>
        req.method === 'session/set_config_option' &&
        req.params?.configId === 'reasoning_effort' &&
        req.params?.sessionId === 'resumed-session-2',
    );
    expect(setEffortCall?.params).toEqual({
      configId: 'reasoning_effort',
      sessionId: 'resumed-session-2',
      value: 'high',
    });
  });
});
