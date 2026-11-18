import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkspaceModule from '../api/workspace';
import { log } from '../utils/logger';
import { registerAgentCommand } from './agent';

const { mockSdkClient, mockTrpcClient } = vi.hoisted(() => ({
  mockSdkClient: { agents: { update: vi.fn() } },
  mockTrpcClient: {
    agent: {
      getBuiltinAgent: { query: vi.fn() },
      updateAgentConfig: { mutate: vi.fn() },
    },
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn(async () => mockTrpcClient) }));
vi.mock('../api/sdk', () => ({ getSdkClient: vi.fn(async () => mockSdkClient) }));
// Personal scope, so the app URL does not depend on the shell's LOBEHUB_WORKSPACE_ID.
vi.mock('../api/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  resolveWorkspaceId: () => undefined,
}));

// Flag-only edits go through `PATCH /api/v1/agents/{id}` (the SDK); the JSON
// config files carry arbitrary keys and stay on the tRPC passthrough.
let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let tempDir: string | undefined;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockSdkClient.agents.update.mockReset();
  mockSdkClient.agents.update.mockResolvedValue({ data: { data: { id: 'a1' }, success: true } });
  mockTrpcClient.agent.getBuiltinAgent.query.mockReset();
  mockTrpcClient.agent.updateAgentConfig.mutate.mockReset();
});

afterEach(async () => {
  exitSpy.mockRestore();
  consoleSpy.mockRestore();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerAgentCommand(program);
  return program;
}

async function writeGraphFixture(graph: unknown) {
  tempDir = await mkdtemp(path.join(tmpdir(), 'lh-agent-graph-'));
  const graphFile = path.join(tempDir, 'graph.json');
  await writeFile(graphFile, JSON.stringify(graph), 'utf8');

  return graphFile;
}

describe('agent edit', () => {
  it('should update agent config', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1', '--title', 'Updated']);

    expect(mockSdkClient.agents.update).toHaveBeenCalledWith({
      body: { title: 'Updated' },
      path: { id: 'a1' },
    });
    expect(mockTrpcClient.agent.updateAgentConfig.mutate).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated agent'));
  });

  it('should accept update as an alias of edit', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'update', 'a1', '--title', 'Updated']);

    expect(mockSdkClient.agents.update).toHaveBeenCalledWith({
      body: { title: 'Updated' },
      path: { id: 'a1' },
    });
    expect(mockTrpcClient.agent.updateAgentConfig.mutate).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated agent'));
  });

  it('should exit when no changes specified', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1']);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should support --slug option', async () => {
    mockTrpcClient.agent.getBuiltinAgent.query.mockResolvedValue({
      id: 'resolved-id',
      title: 'Inbox Agent',
    });
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      '--slug',
      'inbox',
      '--model',
      'gemini-3-pro',
    ]);

    expect(mockTrpcClient.agent.getBuiltinAgent.query).toHaveBeenCalledWith({ slug: 'inbox' });
    expect(mockSdkClient.agents.update).toHaveBeenCalledWith({
      body: { model: 'gemini-3-pro' },
      path: { id: 'resolved-id' },
    });
  });

  it('should update graph config from a validated graph file', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});
    const graph = {
      edges: [{ from: '__root__', instruction: 'Write the final answer.', to: 'answer' }],
      fields: {},
      name: 'answer-graph',
      nodes: { answer: { type: 'llm' } },
      terminal: 'answer',
    };
    const graphFile = await writeGraphFixture(graph);

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--enable-graph',
      '--graph-file',
      graphFile,
    ]);

    expect(mockSdkClient.agents.update).toHaveBeenCalledWith({
      body: {
        agencyConfig: {
          enableGraphMode: true,
          graph,
        },
      },
      path: { id: 'a1' },
    });
  });

  it('should reject conflicting graph enable flags', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--enable-graph',
      '--disable-graph',
    ]);

    expect(log.error).toHaveBeenCalledWith(
      'Use either --enable-graph or --disable-graph, not both.',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.agent.updateAgentConfig.mutate).not.toHaveBeenCalled();
    expect(mockSdkClient.agents.update).not.toHaveBeenCalled();
  });

  it('should reject invalid graph files before updating agent config', async () => {
    const graphFile = await writeGraphFixture({
      edges: [],
      fields: {},
      name: 'invalid-graph',
      nodes: { answer: { type: 'llm' } },
      terminal: 'answer',
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1', '--graph-file', graphFile]);

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read graph JSON: Invalid AgentGraph'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.agent.updateAgentConfig.mutate).not.toHaveBeenCalled();
    expect(mockSdkClient.agents.update).not.toHaveBeenCalled();
  });

  it('should merge agencyConfig from a JSON file, clearing a nested key with null', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});
    // `null` (not undefined) so the server-side deep-merge drops the nested key.
    const agencyConfigFile = await writeGraphFixture({ heterogeneousProvider: null });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--agency-config-file',
      agencyConfigFile,
    ]);

    expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
      agentId: 'a1',
      value: { agencyConfig: { heterogeneousProvider: null } },
    });
  });

  it('should merge a plain-object agencyConfig from a JSON file', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});
    const agencyConfigFile = await writeGraphFixture({ executionTarget: 'none' });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--agency-config-file',
      agencyConfigFile,
    ]);

    expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
      agentId: 'a1',
      value: { agencyConfig: { executionTarget: 'none' } },
    });
  });

  it('should reject a non-object agencyConfig file before updating', async () => {
    const agencyConfigFile = await writeGraphFixture(['not', 'an', 'object']);

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--agency-config-file',
      agencyConfigFile,
    ]);

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('agencyConfig JSON must be a plain object'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.agent.updateAgentConfig.mutate).not.toHaveBeenCalled();
  });

  // The dedicated flags cover six fields; everything else an agent may want
  // to change about itself (opening message, tags, params, …) had no CLI
  // path, even though `agent.updateAgentConfig` is a passthrough server-side.
  it('should send arbitrary config fields from --config-file', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});
    const configFile = await writeGraphFixture({
      openingMessage: 'Hi! Ask me about deploys.',
      tags: ['devops'],
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1', '--config-file', configFile]);

    expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
      agentId: 'a1',
      value: { openingMessage: 'Hi! Ask me about deploys.', tags: ['devops'] },
    });
  });

  it('should let explicit flags win over --config-file', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});
    const configFile = await writeGraphFixture({
      description: 'from file',
      title: 'from file',
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--config-file',
      configFile,
      '--title',
      'from flag',
    ]);

    expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
      agentId: 'a1',
      value: { description: 'from file', title: 'from flag' },
    });
  });

  it('should merge graph flags into an agencyConfig supplied by --config-file', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});
    const configFile = await writeGraphFixture({
      agencyConfig: { modelSelectionPolicy: 'member' },
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--config-file',
      configFile,
      '--enable-graph',
    ]);

    expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
      agentId: 'a1',
      value: { agencyConfig: { enableGraphMode: true, modelSelectionPolicy: 'member' } },
    });
  });

  it('should merge graph flags into an agencyConfig supplied by --agency-config-file', async () => {
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});
    const agencyConfigFile = await writeGraphFixture({
      executionTarget: 'local',
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--agency-config-file',
      agencyConfigFile,
      '--graph-file',
      await writeGraphFixture({
        edges: [{ from: '__root__', instruction: 'Write the final answer.', to: 'answer' }],
        fields: {},
        name: 'answer-graph',
        nodes: { answer: { type: 'llm' } },
        terminal: 'answer',
      }),
      '--enable-graph',
    ]);

    expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
      agentId: 'a1',
      value: {
        agencyConfig: {
          executionTarget: 'local',
          enableGraphMode: true,
          graph: expect.any(Object),
        },
      },
    });
  });

  it('should reject a non-object --config-file before updating', async () => {
    const configFile = await writeGraphFixture(['not', 'an', 'object']);

    const program = createProgram();
    await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1', '--config-file', configFile]);

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('agent config JSON must be a plain object'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockTrpcClient.agent.updateAgentConfig.mutate).not.toHaveBeenCalled();
  });

  // Without this the caller can only assume the write landed — which is
  // exactly how a silently mis-scoped edit goes unnoticed.
  it('should print the updated agent with --json', async () => {
    // `--json` prints the stored config (`name`, `tags`, …) the REST agent lacks.
    mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({
      id: 'a1',
      tags: ['x'],
      title: 'Updated',
    });

    const program = createProgram();
    await program.parseAsync([
      'node',
      'test',
      'agent',
      'edit',
      'a1',
      '--title',
      'Updated',
      '--json',
    ]);

    expect(mockSdkClient.agents.update).not.toHaveBeenCalled();
    expect(JSON.parse(consoleSpy.mock.calls[0][0])).toMatchObject({
      id: 'a1',
      tags: ['x'],
      title: 'Updated',
    });
    expect(consoleSpy.mock.calls[0][0]).toContain('"url": "https://app.lobehub.com/agent/a1"');
  });
});
