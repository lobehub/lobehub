// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { SkillMount } from './SkillMount';

describe('SkillMount', () => {
  it('routes builtin getByPath requests with the original path and forwarded context', async () => {
    const builtinProvider = { get: vi.fn().mockResolvedValue({ name: 'builtin-skill' }) };
    const service = new SkillMount({ builtin: builtinProvider } as any);

    const result = await service.get({
      agentId: 'agent-1',
      path: './lobe/skills/builtin/skills/builtin-skill/SKILL.md',
      topicId: 'topic-1',
    });

    expect(builtinProvider.get).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/builtin/skills/builtin-skill/SKILL.md',
      resolvedPath: {
        filePath: 'SKILL.md',
        namespace: 'builtin',
        relativePath: 'builtin-skill/SKILL.md',
        skillName: 'builtin-skill',
      },
      topicId: 'topic-1',
    });
    expect(result).toEqual({ name: 'builtin-skill' });
  });

  it('routes installed namespace listByPath requests with the original path and forwarded context', async () => {
    const installedProvider = { list: vi.fn().mockResolvedValue([{ name: 'installed-skill' }]) };
    const service = new SkillMount({ 'installed-active': installedProvider } as any);

    const result = await service.list({
      agentId: 'agent-1',
      path: './lobe/skills/installed/active/skills',
      topicId: 'topic-2',
    });

    expect(installedProvider.list).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/installed/active/skills',
      resolvedPath: {
        namespace: 'installed-active',
        relativePath: '',
      },
      topicId: 'topic-2',
    });
    expect(result).toEqual([{ name: 'installed-skill' }]);
  });

  it('creates agent-topic skills through the writable provider', async () => {
    const agentTopicProvider = {
      create: vi.fn().mockResolvedValue({ path: './lobe/skills/agent-topic/skills/a/SKILL.md' }),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      promote: vi.fn(),
      update: vi.fn(),
    };
    const service = new SkillMount({ 'agent-topic': agentTopicProvider } as any);

    const result = await service.create({
      agentId: 'agent-1',
      content: '# A',
      skillName: 'a',
      targetNamespace: 'agent-topic',
      topicId: 'topic-1',
    });

    expect(agentTopicProvider.create).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: '# A',
      skillName: 'a',
      targetNamespace: 'agent-topic',
      topicId: 'topic-1',
    });
    expect(result.path).toContain('/agent-topic/skills/a/SKILL.md');
  });

  it('routes updateSkill and deleteSkill by path namespace', async () => {
    const agentProvider = {
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      list: vi.fn(),
      update: vi.fn().mockResolvedValue({ path: './lobe/skills/agent/skills/a/SKILL.md' }),
    };
    const service = new SkillMount({ agent: agentProvider } as any);

    const updateResult = await service.update({
      agentId: 'agent-1',
      content: '# Updated',
      path: './lobe/skills/agent/skills/a/SKILL.md',
      topicId: 'topic-1',
    });
    await service.delete({
      agentId: 'agent-1',
      path: './lobe/skills/agent/skills/a/SKILL.md',
      topicId: 'topic-1',
    });

    expect(agentProvider.update).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: '# Updated',
      path: './lobe/skills/agent/skills/a/SKILL.md',
      topicId: 'topic-1',
    });
    expect(agentProvider.delete).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/agent/skills/a/SKILL.md',
      topicId: 'topic-1',
    });
    expect(updateResult.path).toBe('./lobe/skills/agent/skills/a/SKILL.md');
  });

  it('routes promoteSkill through the agent-topic writable provider', async () => {
    const agentTopicProvider = {
      create: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      promote: vi
        .fn()
        .mockResolvedValue({ path: './lobe/skills/agent/skills/promoted-a/SKILL.md' }),
      update: vi.fn(),
    };
    const service = new SkillMount({ 'agent-topic': agentTopicProvider } as any);

    const result = await service.promote({
      agentId: 'agent-1',
      path: './lobe/skills/agent-topic/skills/a/SKILL.md',
      targetName: 'promoted-a',
      topicId: 'topic-1',
    });

    expect(agentTopicProvider.promote).toHaveBeenCalledWith({
      agentId: 'agent-1',
      path: './lobe/skills/agent-topic/skills/a/SKILL.md',
      targetName: 'promoted-a',
      topicId: 'topic-1',
    });
    expect(result.path).toBe('./lobe/skills/agent/skills/promoted-a/SKILL.md');
  });

  it('rejects write operations for non-writable namespaces', async () => {
    const builtinProvider = { get: vi.fn(), list: vi.fn() };
    const service = new SkillMount({ builtin: builtinProvider } as any);

    await expect(
      service.update({
        agentId: 'agent-1',
        content: '# Updated',
        path: './lobe/skills/builtin/skills/a/SKILL.md',
      }),
    ).rejects.toThrow('Namespace "builtin" is not writable');
  });

  it('rejects promoteSkill when the writable provider does not support promotion', async () => {
    const agentProvider = {
      create: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
    };
    const service = new SkillMount({ agent: agentProvider } as any);

    await expect(
      service.promote({
        agentId: 'agent-1',
        path: './lobe/skills/agent/skills/a/SKILL.md',
        topicId: 'topic-1',
      }),
    ).rejects.toThrow('Namespace "agent" does not support promote');
  });
});
