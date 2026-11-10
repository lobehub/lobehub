// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHeteroProjectContext, buildRunProjectContextPrompt } from './projectContext';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listAgents: vi.fn(),
  listKnowledgeBases: vi.fn(),
  listTasks: vi.fn(),
  resolveCoordinatorAgents: vi.fn(async (items: unknown[]) => items),
}));

vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn().mockImplementation(function () {
    return mocks;
  }),
}));

const deps = { db: {} as never, userId: 'user-1' };

describe('buildRunProjectContextPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findById.mockResolvedValue({
      coordinatorAgentId: 'agt-coord',
      description: 'Autumn launch',
      identifier: 'APO',
      name: 'Apollo Renamed',
      status: 'active',
    });
    mocks.listAgents.mockResolvedValue([
      { agent: { id: 'agt-coord', title: 'Coordinator' }, binding: { enabled: true } },
      { agent: { id: 'agt-writer', title: 'Writer' }, binding: { enabled: true, role: 'copy' } },
      { agent: { id: 'agt-off', title: 'Paused' }, binding: { enabled: false, role: 'qa' } },
    ]);
    mocks.listKnowledgeBases.mockResolvedValue([
      { binding: { enabled: true }, knowledgeBase: { id: 'kb-1', name: 'Style guide' } },
      { binding: { enabled: false }, knowledgeBase: { id: 'kb-2', name: 'Old notes' } },
    ]);
    mocks.listTasks.mockResolvedValue([
      { identifier: 'APO-1', name: 'Done', status: 'completed' },
      { assigneeAgentId: 'agt-writer', identifier: 'APO-2', name: 'Draft', status: 'running' },
      { identifier: 'APO-3', name: 'Dropped', status: 'canceled' },
    ]);
  });

  it('reads the live project so renames and membership changes reach the next turn', async () => {
    const prompt = await buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord');

    expect(prompt).toContain('Apollo Renamed');
    expect(prompt).toContain('Writer (agt-writer): copy');
    expect(prompt).not.toContain('agt-off');
    expect(prompt).toContain('Style guide (kb-1)');
    expect(prompt).not.toContain('Old notes');
    expect(prompt).toContain('<open_tasks total="1">');
    expect(prompt).toContain('APO-2');
    expect(prompt).not.toContain('APO-1');
    expect(prompt).toContain('<coordination_rules>');
  });

  it('treats LobeAI as the coordinator of a project whose main agent was cleared', async () => {
    mocks.findById.mockResolvedValue({
      coordinatorAgentId: null,
      identifier: 'APO',
      name: 'Apollo',
      status: 'active',
    });
    mocks.resolveCoordinatorAgents.mockImplementationOnce(async (items: any[]) =>
      items.map((item) => ({ ...item, coordinatorAgentId: 'agt-inbox' })),
    );

    const prompt = await buildRunProjectContextPrompt(deps, 'proj-1', 'agt-inbox');

    expect(prompt).toContain('<coordination_rules>');
  });

  it('adds nothing outside a project or when the project is gone', async () => {
    await expect(buildRunProjectContextPrompt(deps, undefined, 'agt-coord')).resolves.toBe(
      undefined,
    );
    mocks.findById.mockResolvedValue(null);
    await expect(buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord')).resolves.toBe(
      undefined,
    );
  });

  it('degrades to no project block when a read fails', async () => {
    mocks.listTasks.mockRejectedValue(new Error('connection reset'));

    await expect(buildRunProjectContextPrompt(deps, 'proj-1', 'agt-coord')).resolves.toBe(
      undefined,
    );
  });

  it('gives a CLI agent the wrapped context without tool-specific delegation rules', async () => {
    const context = await buildHeteroProjectContext(deps, 'proj-1', 'agt-coord');

    expect(context?.startsWith('<project_context>\n')).toBe(true);
    expect(context?.endsWith('\n</project_context>')).toBe(true);
    expect(context).toContain('Writer (agt-writer): copy');
    expect(context).not.toContain('<coordination_rules>');
    await expect(buildHeteroProjectContext(deps, undefined, 'agt-coord')).resolves.toBe(undefined);
  });
});
