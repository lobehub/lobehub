import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { ragService } from '@/services/rag';
import { useAgentStore } from '@/store/agent';

import { chatService } from './index';
import type { ResolvedAgentConfig } from './mecha';
import * as mechaModule from './mecha';

vi.hoisted(() => {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});

/**
 * Default mock resolvedAgentConfig for tests
 */
const createMockResolvedConfig = (overrides?: {
  agentConfig?: Partial<ResolvedAgentConfig['agentConfig']>;
  chatConfig?: Partial<ResolvedAgentConfig['chatConfig']>;
  enabledManifests?: ResolvedAgentConfig['enabledManifests'];
  enabledToolIds?: string[];
  isBuiltinAgent?: boolean;
  plugins?: string[];
  tools?: ResolvedAgentConfig['tools'];
}): ResolvedAgentConfig =>
  ({
    agentConfig: {
      model: DEFAULT_AGENT_CONFIG.model,
      provider: 'openai',
      systemRole: '',
      chatConfig: {},
      params: {},
      tts: {},
      ...overrides?.agentConfig,
    },
    chatConfig: {
      searchMode: 'off',
      ...overrides?.chatConfig,
    },
    enabledManifests: overrides?.enabledManifests ?? [],
    enabledToolIds: overrides?.enabledToolIds ?? [],
    isBuiltinAgent: overrides?.isBuiltinAgent ?? false,
    plugins: overrides?.plugins ?? [],
    tools: overrides?.tools,
  }) as ResolvedAgentConfig;

beforeEach(() => {
  useAgentStore.setState({ activeAgentId: undefined, agentDocumentsMap: {}, agentMap: {} });
});

afterEach(() => vi.restoreAllMocks());

describe('knowledge file readiness', () => {
  it('should parse an unparsed knowledge file before the context is assembled', async () => {
    const contextEngineeringSpy = vi.spyOn(mechaModule, 'contextEngineering').mockResolvedValue([]);
    vi.spyOn(chatService, 'getChatCompletion').mockResolvedValue(new Response(''));
    const parseSpy = vi
      .spyOn(ragService, 'parseFileContent')
      .mockResolvedValue({ content: 'Project setup steps' } as any);
    useAgentStore.setState({
      activeAgentId: 'agent-1',
      agentMap: {
        'agent-1': {
          files: [
            {
              createdAt: new Date('2026-01-01'),
              enabled: true,
              id: 'file-1',
              name: 'setup.md',
              size: 10,
              type: 'text/markdown',
              updatedAt: new Date('2026-01-01'),
              url: 'https://example.com/setup.md',
            },
          ],
        },
      },
    } as any);

    await chatService.createAssistantMessage({
      agentId: 'agent-1',
      messages: [{ content: 'Hello', role: 'user' }] as UIChatMessage[],
      resolvedAgentConfig: createMockResolvedConfig(),
    });

    expect(parseSpy.mock.calls[0]?.[0]).toBe('file-1');
    // The parse has to land before the context is assembled — afterwards the
    // file is already missing from the prompt.
    expect(parseSpy.mock.invocationCallOrder[0]).toBeLessThan(
      contextEngineeringSpy.mock.invocationCallOrder[0],
    );
    expect(
      (useAgentStore.getState().agentMap['agent-1'] as { files?: { content?: string }[] })
        .files?.[0].content,
    ).toBe('Project setup steps');
  });

  it('should have the parsed content in the store when the context is assembled', async () => {
    // Reading the store after the call cannot tell "hydrated before the context was built"
    // from "hydrated afterwards", so snapshot the value inside the context-engine mock and
    // hold the parse open first to prove execution actually reached hydration.
    let contentWhenContextRan: string | undefined;
    const contextEngineeringSpy = vi
      .spyOn(mechaModule, 'contextEngineering')
      .mockImplementation(async () => {
        contentWhenContextRan = (
          useAgentStore.getState().agentMap['agent-1'] as {
            files?: { content?: string }[];
          }
        ).files?.[0]?.content;
        return [];
      });
    vi.spyOn(chatService, 'getChatCompletion').mockResolvedValue(new Response(''));

    let releaseParse: (value: { content: string }) => void = () => {};
    const parseSpy = vi.spyOn(ragService, 'parseFileContent').mockReturnValue(
      new Promise<{ content: string }>((resolve) => {
        releaseParse = resolve;
      }) as any,
    );
    useAgentStore.setState({
      activeAgentId: 'agent-1',
      agentMap: {
        'agent-1': {
          files: [
            {
              createdAt: new Date('2026-01-01'),
              enabled: true,
              id: 'file-1',
              name: 'setup.md',
              size: 10,
              type: 'text/markdown',
              updatedAt: new Date('2026-01-01'),
              url: 'https://example.com/setup.md',
            },
          ],
        },
      },
    } as any);

    const pending = chatService.createAssistantMessage({
      agentId: 'agent-1',
      messages: [{ content: 'Hello', role: 'user' }] as UIChatMessage[],
      resolvedAgentConfig: createMockResolvedConfig(),
    });

    await vi.waitFor(() => expect(parseSpy).toHaveBeenCalled());
    expect(parseSpy.mock.calls[0]?.[0]).toBe('file-1');
    // Hydration is still in flight, so the context must not have been assembled yet.
    expect(contextEngineeringSpy).not.toHaveBeenCalled();

    releaseParse({ content: 'Project setup steps' });
    await pending;

    expect(contextEngineeringSpy).toHaveBeenCalled();
    expect(contentWhenContextRan).toBe('Project setup steps');
  });

  it('should stop waiting for hydration once the send is aborted', async () => {
    // The caller's signal cancels the waiting only, never the shared parse — another
    // send may still be waiting on it — so an aborted send has to proceed to assemble
    // its context instead of hanging on a parse that never settles.
    const contextEngineeringSpy = vi.spyOn(mechaModule, 'contextEngineering').mockResolvedValue([]);
    vi.spyOn(chatService, 'getChatCompletion').mockResolvedValue(new Response(''));
    vi.spyOn(ragService, 'parseFileContent').mockReturnValue(
      new Promise<{ content: string }>(() => {}) as any,
    );
    useAgentStore.setState({
      activeAgentId: 'agent-1',
      agentMap: {
        'agent-1': {
          files: [
            {
              createdAt: new Date('2026-01-01'),
              enabled: true,
              id: 'file-1',
              name: 'setup.md',
              size: 10,
              type: 'text/markdown',
              updatedAt: new Date('2026-01-01'),
              url: 'https://example.com/setup.md',
            },
          ],
        },
      },
    } as any);

    const controller = new AbortController();
    controller.abort();

    const pending = chatService.createAssistantMessage(
      {
        agentId: 'agent-1',
        messages: [{ content: 'Hello', role: 'user' }] as UIChatMessage[],
        resolvedAgentConfig: createMockResolvedConfig(),
      },
      { signal: controller.signal },
    );

    await vi.waitFor(() => expect(contextEngineeringSpy).toHaveBeenCalled());
    await pending;
  });

  it('passes the per-send failure marker into the actual prompt', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ragService, 'parseFileContent').mockRejectedValue(new Error('unsupported format'));
    const create = vi.spyOn(chatService, 'getChatCompletion').mockResolvedValue(new Response(''));
    const context = vi.spyOn(mechaModule, 'contextEngineering');
    useAgentStore.setState({
      activeAgentId: 'agent-1',
      agentMap: {
        'agent-1': {
          files: [
            { enabled: true, id: 'broken-file', name: 'broken.md', type: 'text/markdown' },
            { enabled: true, id: 'cached-file', name: 'cached.md', content: 'cached text' },
            { enabled: false, id: 'disabled-file', name: 'disabled.md', content: 'secret fixture' },
          ],
        },
      },
    } as any);

    await chatService.createAssistantMessage({
      agentId: 'agent-1',
      messages: [{ content: 'Hello', role: 'user' }] as UIChatMessage[],
      resolvedAgentConfig: createMockResolvedConfig(),
    });

    expect(errorSpy).toHaveBeenCalledWith(
      '[AgentStore] Failed to parse knowledge file:',
      'broken-file',
      expect.any(Error),
    );
    expect(create).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(await context.mock.results[0].value);
    expect(prompt).toContain('The file is attached but its contents could not be extracted.');
    expect(prompt).toContain('broken.md');
    expect(prompt).toContain('cached text');
    expect(prompt).not.toContain('secret fixture');
  });
});
