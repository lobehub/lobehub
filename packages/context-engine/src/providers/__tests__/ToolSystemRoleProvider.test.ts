import { describe, expect, it } from 'vitest';

import type { LobeToolManifest } from '../../engine/tools/types';
import type { PipelineContext } from '../../types';
import { ToolSystemRoleProvider } from '../ToolSystemRole';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  messages,
  metadata: { model: 'gpt-4', maxTokens: 4096 },
  isAborted: false,
});

const createMockManifests = (identifiers: string[]): LobeToolManifest[] =>
  identifiers.map((id) => ({
    identifier: id,
    api: [{ name: 'action', description: `${id} action`, parameters: {} }],
    meta: { title: id },
    type: 'default' as const,
  }));

describe('ToolSystemRoleProvider', () => {
  it('should inject tool system role when manifests are provided and FC is supported', async () => {
    const mockIsCanUseFC = () => true;
    const manifests = createMockManifests(['calculator', 'weather']);

    const provider = new ToolSystemRoleProvider({
      manifests,
      model: 'gpt-4',
      provider: 'openai',
      isCanUseFC: mockIsCanUseFC,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'What is 2+2?' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should have system message with tool system role
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain('calculator');
    expect(systemMessage!.content).toContain('weather');

    // Should update metadata
    expect(result.metadata.toolSystemRole).toBeDefined();
    expect(result.metadata.toolSystemRole.injected).toBe(true);
    expect(result.metadata.toolSystemRole.supportsFunctionCall).toBe(true);
  });

  it('should merge tool system role with existing system message', async () => {
    const mockIsCanUseFC = () => true;
    const manifests = createMockManifests(['calculator']);

    const provider = new ToolSystemRoleProvider({
      manifests,
      model: 'gpt-4',
      provider: 'openai',
      isCanUseFC: mockIsCanUseFC,
    });

    const existingSystemContent = 'You are a helpful assistant.';
    const messages = [
      { id: 's1', role: 'system', content: existingSystemContent },
      { id: 'u1', role: 'user', content: 'Calculate something' },
    ];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toContain(existingSystemContent);
    expect(systemMessage!.content).toContain('calculator');
  });

  it('should skip injection when no manifests are provided', async () => {
    const mockIsCanUseFC = () => true;

    const provider = new ToolSystemRoleProvider({
      manifests: [],
      model: 'gpt-4',
      provider: 'openai',
      isCanUseFC: mockIsCanUseFC,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Hello' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should not have system message
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeUndefined();

    // Should not have metadata
    expect(result.metadata.toolSystemRole).toBeUndefined();
  });

  it('should skip injection when function calling is not supported', async () => {
    const mockIsCanUseFC = () => false;
    const manifests = createMockManifests(['calculator']);

    const provider = new ToolSystemRoleProvider({
      manifests,
      model: 'gpt-3.5-turbo',
      provider: 'openai',
      isCanUseFC: mockIsCanUseFC,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Calculate something' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should not have system message
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeUndefined();
  });

  it('should inject manifest systemRole into the prompt', async () => {
    const mockIsCanUseFC = () => true;

    // Manifest with custom systemRole
    const manifests: LobeToolManifest[] = [
      {
        identifier: 'gtd-tool',
        api: [{ name: 'createTask', description: 'Create a task', parameters: {} }],
        meta: { title: 'GTD Tool' },
        type: 'builtin',
        systemRole: 'You are a GTD expert. Always help users organize tasks effectively.',
      },
    ];

    const provider = new ToolSystemRoleProvider({
      manifests,
      model: 'gpt-4',
      provider: 'openai',
      isCanUseFC: mockIsCanUseFC,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Create a task' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    // Should contain the manifest's systemRole content
    expect(systemMessage!.content).toContain('GTD expert');
    expect(systemMessage!.content).toContain('organize tasks effectively');
  });

  it('should inject systemRole even when manifest has no apis', async () => {
    const mockIsCanUseFC = () => true;

    // Manifest with systemRole but no APIs
    const manifests: LobeToolManifest[] = [
      {
        identifier: 'knowledge-tool',
        api: [],
        meta: { title: 'Knowledge Tool' },
        type: 'builtin',
        systemRole: 'You have access to a knowledge base. Use it wisely.',
      },
    ];

    const provider = new ToolSystemRoleProvider({
      manifests,
      model: 'gpt-4',
      provider: 'openai',
      isCanUseFC: mockIsCanUseFC,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Search knowledge' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    // Should contain the systemRole even without APIs
    expect(systemMessage!.content).toContain('knowledge base');
    expect(systemMessage!.content).toContain('Use it wisely');
  });

  it('should skip injection when manifests have no systemRole and no apis', async () => {
    const mockIsCanUseFC = () => true;

    // Empty manifests (no APIs)
    const manifests: LobeToolManifest[] = [
      {
        identifier: 'empty-tool',
        api: [],
        meta: { title: 'Empty Tool' },
        type: 'default',
      },
    ];

    const provider = new ToolSystemRoleProvider({
      manifests,
      model: 'gpt-4',
      provider: 'openai',
      isCanUseFC: mockIsCanUseFC,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Calculate something' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should not have system message (empty tools produce no prompt)
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeUndefined();
  });
});
