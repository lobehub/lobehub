import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ToolNameResolver } from '@lobechat/context-engine';
import type { ReasoningGraph } from '@lobechat/types';
import { AGENT_GRAPH_ROOT_NODE_ID, ReasoningGraphSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { AgentInstruction, AgentRuntimeContext, AgentState } from '../../types';
import { GraphAgent } from '../GraphAgent';

const GRAPH_RUNTIME_STATE_KEY = '__graphRuntimeState';
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

interface TestGraphRuntimeState {
  graphContext: {
    store: Record<PropertyKey, unknown>;
  };
  graphState: unknown;
  instructionCount: number;
}

const toolNameResolver = new ToolNameResolver();
const readToolName = toolNameResolver.generate('workspace', 'read', 'builtin');
const searchToolName = toolNameResolver.generate('workspace', 'search', 'builtin');
const writeToolName = toolNameResolver.generate('workspace', 'write', 'builtin');

const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
  operationId: 'test-operation',
  status: 'running',
  messages: [],
  toolManifestMap: {
    workspace: {
      api: [{ name: 'read' }, { name: 'search' }, { name: 'write' }],
      type: 'builtin',
    },
  },
  tools: [
    { function: { name: readToolName }, type: 'function' },
    { function: { name: searchToolName }, type: 'function' },
    { function: { name: writeToolName }, type: 'function' },
  ],
  usage: {
    llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
    tools: { totalCalls: 0, totalTimeMs: 0, byTool: [] },
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
  },
  cost: {
    calculatedAt: new Date().toISOString(),
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: new Date().toISOString(),
  lastModified: new Date().toISOString(),
  stepCount: 0,
  ...overrides,
});

const createContext = (
  phase: AgentRuntimeContext['phase'],
  payload?: AgentRuntimeContext['payload'],
): AgentRuntimeContext => ({ payload, phase });

const createLlmResultContext = (content: string): AgentRuntimeContext =>
  createContext('llm_result', {
    hasToolsCalling: false,
    result: { content, tool_calls: [] },
    toolsCalling: [],
  });

const getGraphRuntimeState = (state: AgentState) =>
  state.metadata?.[GRAPH_RUNTIME_STATE_KEY] as TestGraphRuntimeState | undefined;

const getGraphState = (state: AgentState) => getGraphRuntimeState(state)?.graphState;

const getGraphStore = (state: AgentState) => getGraphRuntimeState(state)?.graphContext.store;

const getInstructionCount = (state: AgentState) => getGraphRuntimeState(state)?.instructionCount;

const expectCallLlm = (instruction: AgentInstruction | AgentInstruction[]) => {
  expect(Array.isArray(instruction)).toBe(false);
  expect(instruction).toMatchObject({ type: 'call_llm' });

  return instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
};

const getLastPrompt = (instruction: AgentInstruction | AgentInstruction[]) => {
  const callLlm = expectCallLlm(instruction);
  const lastMessage = callLlm.payload.messages.at(-1);

  return typeof lastMessage?.content === 'string' ? lastMessage.content : '';
};

const loadGoalLoopGraph = (): ReasoningGraph => {
  const graph = JSON.parse(
    readFileSync(path.join(TEST_DIR, 'fixtures/goal-loop.graph.json'), 'utf8'),
  );
  const result = ReasoningGraphSchema.safeParse(graph);

  if (!result.success) {
    throw new Error(JSON.stringify(result.error.format(), null, 2));
  }

  return result.data;
};

const parseGraph = (graph: unknown) => ReasoningGraphSchema.safeParse(graph);

describe('GraphAgent', () => {
  describe('schema', () => {
    it('should accept the goal-loop fixture', () => {
      expect(parseGraph(loadGoalLoopGraph()).success).toBe(true);
    });

    it('should require exactly one root edge', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        edges: graph.edges.filter((edge) => edge.from !== AGENT_GRAPH_ROOT_NODE_ID),
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: `Graph must define exactly one "${AGENT_GRAPH_ROOT_NODE_ID}" outgoing edge`,
            path: ['edges'],
          }),
        ]),
      );
    });

    it('should reject edge endpoints that do not reference graph nodes', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        edges: [
          ...graph.edges,
          {
            from: 'missing-source',
            instruction: 'Invalid source',
            to: 'missing-target',
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: `Edge from must reference an existing node or "${AGENT_GRAPH_ROOT_NODE_ID}"`,
            path: ['edges', graph.edges.length, 'from'],
          }),
          expect.objectContaining({
            message: 'Edge to must reference an existing node',
            path: ['edges', graph.edges.length, 'to'],
          }),
        ]),
      );
    });

    it('should require edge field refs to point at registered graph fields', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.from === 'plan'
            ? {
                ...edge,
                input: {
                  fields: [{ field: 'missing-field', from: 'plan' }],
                },
              }
            : edge,
        ),
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Edge input field "missing-field" must reference a registered graph field',
          }),
        ]),
      );
    });

    it('should reject duplicate default edges from the same source', () => {
      const graph = loadGoalLoopGraph();
      const planEdge = graph.edges.find((edge) => edge.from === 'plan');
      const result = parseGraph({
        ...graph,
        edges: [
          ...graph.edges,
          {
            ...planEdge,
            instruction: 'Another default plan edge',
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Only one default edge without condition is allowed from "plan"',
          }),
        ]),
      );
    });

    it('should require condition to be a JSON schema object', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.from === 'verify'
            ? {
                ...edge,
                condition: 'output.review.fin === false',
              }
            : edge,
        ),
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['edges', 3, 'condition'],
          }),
        ]),
      );
    });

    it('should reject invalid field JSON schemas', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        fields: {
          ...graph.fields,
          goals: {
            ...graph.fields.goals,
            schema: {
              type: 1,
            },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining(
              'Graph field "goals" schema must be a valid JSON Schema',
            ),
            path: ['fields', 'goals', 'schema'],
          }),
        ]),
      );
    });

    it('should reject descriptions inside field JSON schemas', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        fields: {
          ...graph.fields,
          goals: {
            ...graph.fields.goals,
            schema: {
              ...graph.fields.goals.schema,
              items: {
                ...(graph.fields.goals.schema.items as Record<string, unknown>),
                properties: {
                  desc: {
                    description: 'Do not put prompt wording inside JSON Schema.',
                    type: 'string',
                  },
                  name: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Graph field "goals" schema must not contain "description"; field schemas are only for validation. Use the graph field desc or edge field desc instead.',
            path: ['fields', 'goals', 'schema', 'items', 'properties', 'desc', 'description'],
          }),
        ]),
      );
    });

    it('should allow description as a schema property name', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        fields: {
          ...graph.fields,
          goals: {
            ...graph.fields.goals,
            schema: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                },
              },
              required: ['description'],
            },
          },
        },
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid condition JSON schemas before runtime routing', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.from === 'verify'
            ? {
                ...edge,
                condition: {
                  unknownKeyword: true,
                },
              }
            : edge,
        ),
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('Edge condition must be a valid JSON Schema'),
            path: ['edges', 3, 'condition'],
          }),
        ]),
      );
    });

    it('should reject terminal nodes that do not exist', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        terminal: 'missing-terminal',
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Graph terminal must reference an existing node',
            path: ['terminal'],
          }),
        ]),
      );
    });

    it('should reject input fields whose source node does not exist', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.from === 'work'
            ? {
                ...edge,
                input: {
                  fields: [{ field: 'summary', from: 'missing-node' }],
                },
              }
            : edge,
        ),
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Edge input source node "missing-node" must reference an existing node or "__root__"',
          }),
        ]),
      );
    });

    it('should reject duplicate input and output fields on the same edge', () => {
      const graph = loadGoalLoopGraph();
      const result = parseGraph({
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.from === 'plan'
            ? {
                ...edge,
                input: {
                  fields: [
                    { field: 'goals', from: 'plan' },
                    { field: 'goals', from: 'plan' },
                  ],
                },
                output: {
                  fields: [{ field: 'summary' }, { field: 'summary' }],
                },
              }
            : edge,
        ),
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Edge input field "goals" is duplicated',
          }),
          expect.objectContaining({
            message: 'Edge output field "summary" is duplicated',
          }),
        ]),
      );
    });
  });

  describe('prompt', () => {
    it('should render node instruction, upstream field value, upstream field description, and deliverable target', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal verify prompt contract', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      const goals = [
        {
          desc: 'Ensure prompt contains values and field semantics.',
          name: 'close prompt loop',
        },
      ];
      const workInstruction = await agent.runner(
        createLlmResultContext(JSON.stringify({ goals })),
        state,
      );
      const prompt = getLastPrompt(workInstruction);

      expect(prompt).toContain('<task_instruction>');
      expect(prompt).toContain('<input_context>');
      expect(prompt).toContain('<output_contract>');
      expect(prompt).not.toContain('<taskInstruction>');
      expect(prompt).not.toContain('<inputContext>');
      expect(prompt).not.toContain('<outputContract>');
      expect(prompt).toContain(
        'Complete the planned goals. Work through the provided goals and summarize what changed.',
      );
      expect(prompt).toContain('close prompt loop');
      expect(prompt).toContain('Ensure prompt contains values and field semantics.');
      expect(prompt).toContain('Concrete goals planned from the user request.');
      expect(prompt).toContain('summary');
      expect(prompt).toContain('Worker summary describing completed work and remaining risk.');
    });

    it('should render multi-source input context and verifier output contract', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal verify multi-source prompt', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      const goals = [
        {
          desc: 'Render upstream plan fields and worker result together.',
          name: 'join context',
        },
      ];
      await agent.runner(createLlmResultContext(JSON.stringify({ goals })), state);

      const summary = 'The worker joined context from plan and work.';
      const verifyInstruction = await agent.runner(
        createLlmResultContext(JSON.stringify({ summary })),
        state,
      );
      const prompt = getLastPrompt(verifyInstruction);

      expect(prompt).toContain(
        'Verify whether the work satisfies the planned goals. Return fin=true only when all goals are complete.',
      );
      expect(prompt).toContain('Concrete goals planned from the user request.');
      expect(prompt).toContain('Render upstream plan fields and worker result together.');
      expect(prompt).toContain('Worker summary describing completed work and remaining risk.');
      expect(prompt).toContain(summary);
      expect(prompt).toContain('review');
      expect(prompt).toContain('Verifier decision and unfinished goals.');
    });

    it('should render extraction instruction, format instruction, schema, and previous error', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal verify extraction prompt', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      const extractionInstruction = await agent.runner(
        createLlmResultContext('planning notes without json'),
        state,
      );
      const prompt = getLastPrompt(extractionInstruction);

      expect(prompt).toContain('<extraction_task>');
      expect(prompt).toContain('<format_instruction>');
      expect(prompt).not.toContain('<output_format>');
      expect(prompt).toContain('Extract the planned goals.');
      expect(prompt).toContain('markdown fenced code block tagged json');
      expect(prompt).toContain('<output_schema>');
      expect(prompt).toContain('Concrete goals planned from the user request.');
      expect(prompt).toContain('<previous_error>');
      expect(prompt).toContain('The node output is not valid JSON.');
    });

    it('should render raw fallback context once when declared input fields are missing', async () => {
      const goalLoopGraph = loadGoalLoopGraph();
      const graph: ReasoningGraph = {
        ...goalLoopGraph,
        edges: goalLoopGraph.edges.map((edge) =>
          edge.from === 'plan'
            ? {
                ...edge,
                input: {
                  fields: [
                    { field: 'goals', from: 'plan' },
                    { field: 'summary', from: 'plan' },
                  ],
                },
              }
            : edge,
        ),
      };
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph,
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal verify raw fallback prompt', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      let workInstruction: AgentInstruction | AgentInstruction[] | undefined;
      for (const content of [
        'not json',
        'still not json',
        'nope',
        'plan failed but left useful raw planning notes',
      ]) {
        workInstruction = await agent.runner(createLlmResultContext(content), state);
      }
      if (!workInstruction) throw new Error('Expected work instruction');
      const prompt = getLastPrompt(workInstruction);

      expect(prompt).toContain('rawFallback');
      expect(prompt).toContain(
        'Declared input fields were missing from this source output. Use this raw source output as fallback context.',
      );
      expect(prompt).toContain('plan failed but left useful raw planning notes');
      expect(prompt.match(/plan failed but left useful raw planning notes/g)).toHaveLength(1);
    });
  });

  describe('e2e', () => {
    it('should keep the goal-loop fixture aligned with the graph schema', () => {
      const graph = loadGoalLoopGraph();

      expect(graph.terminal).toBe('verify');
      expect(graph.nodes).toMatchObject({
        plan: { allowedToolApiNames: ['read', 'search'], type: 'agent' },
        verify: { type: 'llm' },
        work: { type: 'agent' },
      });
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: AGENT_GRAPH_ROOT_NODE_ID,
            to: 'plan',
          }),
          expect.objectContaining({
            from: 'verify',
            maxTraversals: 3,
            to: 'work',
          }),
        ]),
      );
    });

    it('should execute the /goal plan-work-verify loop with mocked llm outputs', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal refactor graph agent runtime', role: 'user' }],
      });

      const planInstruction = await agent.runner(createContext('init'), state);
      const planCall = expectCallLlm(planInstruction);

      expect(planCall.stepLabel).toBe('plan');
      expect(planCall.payload.allowedToolNames).toEqual([readToolName, searchToolName]);
      const planTools = planCall.payload.tools as Array<{ function: { name: string } }> | undefined;
      expect(planTools?.map((tool) => tool.function.name)).toEqual([readToolName, searchToolName]);
      expect(getGraphStore(state)?.[AGENT_GRAPH_ROOT_NODE_ID]).toEqual({
        query: '/goal refactor graph agent runtime',
      });
      expect(getLastPrompt(planInstruction)).toContain('/goal refactor graph agent runtime');

      const goals = [
        { desc: 'Define the graph schema for goal loops.', name: 'design schema' },
        { desc: 'Cover the plan-work-verify loop with tests.', name: 'add tests' },
      ];
      const workInstruction = await agent.runner(
        createLlmResultContext(`\`\`\`json\n${JSON.stringify({ goals })}\n\`\`\``),
        state,
      );

      expect(getGraphStore(state)?.plan).toEqual({ goals });
      expect(getGraphState(state)).toMatchObject({ currentNode: 'work', phase: 'node_in' });
      const workCall = expectCallLlm(workInstruction);
      expect(workCall.stepLabel).toBe('work');
      expect(workCall.payload.allowedToolNames).toBeUndefined();
      expect(getLastPrompt(workInstruction)).toContain('design schema');
      expect(getLastPrompt(workInstruction)).toContain(
        'Cover the plan-work-verify loop with tests.',
      );

      const firstSummary = 'Implemented the graph schema and started the test wiring.';
      const verifyInstruction = await agent.runner(
        createLlmResultContext(JSON.stringify({ summary: firstSummary })),
        state,
      );

      expect(getGraphStore(state)?.work).toEqual({ summary: firstSummary });
      expect(getGraphState(state)).toMatchObject({ currentNode: 'verify', phase: 'node_in' });
      const verifyCall = expectCallLlm(verifyInstruction);
      expect(verifyCall.stepLabel).toBe('verify');
      expect(verifyCall.payload.allowedToolNames).toEqual([]);
      expect(verifyCall.payload.tools).toEqual([]);
      expect(getLastPrompt(verifyInstruction)).toContain('design schema');
      expect(getLastPrompt(verifyInstruction)).toContain(firstSummary);

      const unfinishedGoal = {
        desc: 'The goal-loop E2E still needs a passing verification branch.',
        name: 'finish tests',
      };
      const reworkInstruction = await agent.runner(
        createLlmResultContext(
          JSON.stringify({
            review: {
              fin: false,
              unfinish: [unfinishedGoal],
            },
          }),
        ),
        state,
      );

      expect(getGraphStore(state)?.verify).toEqual({
        review: {
          fin: false,
          unfinish: [unfinishedGoal],
        },
      });
      expect(getGraphState(state)).toMatchObject({ currentNode: 'work', phase: 'node_in' });
      expect(expectCallLlm(reworkInstruction).stepLabel).toBe('work');
      expect(getLastPrompt(reworkInstruction)).toContain('finish tests');
      expect(getLastPrompt(reworkInstruction)).toContain(
        'The goal-loop E2E still needs a passing verification branch.',
      );

      const finalSummary = 'Completed schema, runtime wiring, and goal-loop E2E tests.';
      const finalVerifyInstruction = await agent.runner(
        createLlmResultContext(JSON.stringify({ summary: finalSummary })),
        state,
      );

      expect(getGraphStore(state)?.work).toEqual({ summary: finalSummary });
      expect(getGraphState(state)).toMatchObject({ currentNode: 'verify', phase: 'node_in' });
      expect(expectCallLlm(finalVerifyInstruction).stepLabel).toBe('verify');
      expect(getLastPrompt(finalVerifyInstruction)).toContain(finalSummary);

      const result = await agent.runner(
        createLlmResultContext(
          JSON.stringify({
            review: {
              fin: true,
              unfinish: [],
            },
          }),
        ),
        state,
      );

      expect(getGraphStore(state)?.verify).toEqual({
        review: {
          fin: true,
          unfinish: [],
        },
      });
      expect(getGraphState(state)).toMatchObject({ phase: 'fin', reason: 'completed' });
      expect(result).toMatchObject({ reason: 'completed', type: 'finish' });
    });

    it('should preserve node tool allow-list when delegating to GeneralChatAgent', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal inspect workspace', role: 'user' }],
      });

      expectCallLlm(await agent.runner(createContext('init'), state));

      const instruction = await agent.runner(
        createContext('tools_batch_result', { parentMessageId: 'tool-msg-1' }),
        state,
      );
      const call = expectCallLlm(instruction);

      expect(call.payload.allowedToolNames).toEqual([readToolName, searchToolName]);
      expect(
        call.payload.tools?.map((tool: { function: { name: string } }) => tool.function.name),
      ).toEqual([readToolName, searchToolName]);
    });

    it('should not add a tool allow-list when delegating an unrestricted agent node', async () => {
      const graph = loadGoalLoopGraph();
      const planNode = graph.nodes.plan;
      if (planNode.type !== 'agent') throw new Error('Expected plan to be an agent node');
      const { allowedToolApiNames: _, ...unrestrictedPlan } = planNode;
      graph.nodes.plan = unrestrictedPlan;
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph,
        modelRuntimeConfig: { model: 'gpt-4', provider: 'openai' },
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal inspect workspace', role: 'user' }],
      });

      const initialCall = expectCallLlm(await agent.runner(createContext('init'), state));
      expect(initialCall.payload.allowedToolNames).toBeUndefined();

      const instruction = await agent.runner(
        createContext('tools_batch_result', { parentMessageId: 'tool-msg-1' }),
        state,
      );
      const delegatedCall = expectCallLlm(instruction);

      expect(delegatedCall.payload.allowedToolNames).toBeUndefined();
      expect(
        delegatedCall.payload.tools?.map(
          (tool: { function: { name: string } }) => tool.function.name,
        ),
      ).toEqual([readToolName, searchToolName, writeToolName]);
    });

    it('should stop before producing more runtime instructions when maxInstructionCount is reached', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: {
          ...loadGoalLoopGraph(),
          maxInstructionCount: 1,
        },
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal stop after first instruction', role: 'user' }],
      });

      expectCallLlm(await agent.runner(createContext('init'), state));
      expect(getInstructionCount(state)).toBe(1);

      const result = await agent.runner(
        createLlmResultContext(
          JSON.stringify({
            goals: [{ desc: 'This output should not be consumed.', name: 'ignored' }],
          }),
        ),
        state,
      );

      expect(result).toMatchObject({
        reason: 'error_recovery',
        reasonDetail: expect.stringContaining('graph_instruction_limit_reached'),
        type: 'finish',
      });
      expect(getInstructionCount(state)).toBe(1);
      expect(getGraphStore(state)?.plan).toBeUndefined();
    });

    it('should not increment instructionCount for graph finish instructions', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal finish without extra instruction count', role: 'user' }],
      });

      expectCallLlm(await agent.runner(createContext('init'), state));
      expectCallLlm(
        await agent.runner(
          createLlmResultContext(
            JSON.stringify({
              goals: [{ desc: 'Finish counting should remain stable.', name: 'count' }],
            }),
          ),
          state,
        ),
      );
      expectCallLlm(
        await agent.runner(
          createLlmResultContext(JSON.stringify({ summary: 'Completed the count goal.' })),
          state,
        ),
      );
      expect(getInstructionCount(state)).toBe(3);

      const result = await agent.runner(
        createLlmResultContext(JSON.stringify({ review: { fin: true, unfinish: [] } })),
        state,
      );

      expect(result).toMatchObject({ reason: 'completed', type: 'finish' });
      expect(getInstructionCount(state)).toBe(3);
    });

    it('should skip output extraction when the incoming edge does not declare output fields', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: {
          edges: [
            {
              from: AGENT_GRAPH_ROOT_NODE_ID,
              instruction: 'Generate the final report.',
              to: 'report',
            },
          ],
          fields: {},
          name: 'report-only',
          nodes: {
            report: { type: 'llm' },
          },
          terminal: 'report',
        },
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: 'Write a final report without structured output.', role: 'user' }],
      });

      const reportInstruction = await agent.runner(createContext('init'), state);

      expect(expectCallLlm(reportInstruction).stepLabel).toBe('report');

      const result = await agent.runner(
        createLlmResultContext('## Final report\n\nThis is a natural language answer.'),
        state,
      );

      expect(result).toMatchObject({ reason: 'completed', type: 'finish' });
      expect(getGraphStore(state)?.report).toBeUndefined();
      expect(getGraphState(state)).toMatchObject({ phase: 'fin', reason: 'completed' });
    });

    it('should move an agent node to output extraction when maxAgentSteps is reached', async () => {
      const graph = loadGoalLoopGraph();
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: {
          ...graph,
          nodes: {
            ...graph.nodes,
            plan: { allowedToolApiNames: ['read', 'search'], maxAgentSteps: 1, type: 'agent' },
          },
        },
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal enforce node budget', role: 'user' }],
      });

      expectCallLlm(await agent.runner(createContext('init'), state));
      state.stepCount = 1;

      const extractionInstruction = await agent.runner(createContext('init'), state);
      const prompt = getLastPrompt(extractionInstruction);

      expect(expectCallLlm(extractionInstruction).stepLabel).toBe('plan:extract');
      expect(getGraphState(state)).toMatchObject({
        active: true,
        attempts: 1,
        currentNode: 'plan',
        nodeStepLimitExceeded: true,
        phase: 'node_out',
      });
      expect(prompt).toContain('The node reached its action budget.');
      expect(prompt).toContain('The node output JSON must be an object.');
    });

    it('should route by matching condition before default and fall back when condition misses', async () => {
      const graph: ReasoningGraph = {
        edges: [
          {
            from: AGENT_GRAPH_ROOT_NODE_ID,
            instruction: 'Produce a route value.',
            output: { fields: [{ field: 'route' }] },
            to: 'source',
          },
          {
            condition: {
              properties: {
                route: { const: 'go' },
              },
              required: ['route'],
              type: 'object',
            },
            from: 'source',
            input: { fields: [{ field: 'route', from: 'source' }] },
            instruction: 'Matched route instruction.',
            output: { fields: [{ field: 'result' }] },
            to: 'matched',
          },
          {
            from: 'source',
            input: { fields: [{ field: 'route', from: 'source' }] },
            instruction: 'Fallback route instruction.',
            output: { fields: [{ field: 'result' }] },
            to: 'fallback',
          },
        ],
        fields: {
          result: {
            desc: 'Terminal result.',
            schema: { type: 'string' },
          },
          route: {
            desc: 'Routing flag.',
            schema: { type: 'string' },
          },
        },
        name: 'condition-routing',
        nodes: {
          fallback: { type: 'llm' },
          matched: { type: 'llm' },
          source: { type: 'llm' },
        },
        terminal: 'fallback',
      };
      const matchedAgent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph,
        operationId: 'test-operation',
      });
      const matchedState = createMockState({
        messages: [{ content: '/goal route matched', role: 'user' }],
      });

      expectCallLlm(await matchedAgent.runner(createContext('init'), matchedState));
      const matchedInstruction = await matchedAgent.runner(
        createLlmResultContext(JSON.stringify({ route: 'go' })),
        matchedState,
      );

      expect(expectCallLlm(matchedInstruction).stepLabel).toBe('matched');
      expect(getLastPrompt(matchedInstruction)).toContain('Matched route instruction.');
      expect(getLastPrompt(matchedInstruction)).toContain('go');

      const fallbackAgent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph,
        operationId: 'test-operation',
      });
      const fallbackState = createMockState({
        messages: [{ content: '/goal route fallback', role: 'user' }],
      });

      expectCallLlm(await fallbackAgent.runner(createContext('init'), fallbackState));
      const fallbackInstruction = await fallbackAgent.runner(
        createLlmResultContext(JSON.stringify({ route: 'stop' })),
        fallbackState,
      );

      expect(expectCallLlm(fallbackInstruction).stepLabel).toBe('fallback');
      expect(getLastPrompt(fallbackInstruction)).toContain('Fallback route instruction.');
      expect(getLastPrompt(fallbackInstruction)).toContain('stop');
    });

    it('should treat invalid condition schemas as no match and use the default edge', async () => {
      const graph: ReasoningGraph = {
        edges: [
          {
            from: AGENT_GRAPH_ROOT_NODE_ID,
            instruction: 'Produce a route value.',
            output: { fields: [{ field: 'route' }] },
            to: 'source',
          },
          {
            condition: {
              unknownKeyword: true,
            },
            from: 'source',
            input: { fields: [{ field: 'route', from: 'source' }] },
            instruction: 'Invalid condition route.',
            output: { fields: [{ field: 'result' }] },
            to: 'matched',
          },
          {
            from: 'source',
            input: { fields: [{ field: 'route', from: 'source' }] },
            instruction: 'Default route after invalid condition.',
            output: { fields: [{ field: 'result' }] },
            to: 'fallback',
          },
        ],
        fields: {
          result: {
            desc: 'Terminal result.',
            schema: { type: 'string' },
          },
          route: {
            desc: 'Routing flag.',
            schema: { type: 'string' },
          },
        },
        name: 'invalid-condition-routing',
        nodes: {
          fallback: { type: 'llm' },
          matched: { type: 'llm' },
          source: { type: 'llm' },
        },
        terminal: 'fallback',
      };
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph,
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal invalid condition fallback', role: 'user' }],
      });

      expectCallLlm(await agent.runner(createContext('init'), state));
      const fallbackInstruction = await agent.runner(
        createLlmResultContext(JSON.stringify({ route: 'anything' })),
        state,
      );

      expect(expectCallLlm(fallbackInstruction).stepLabel).toBe('fallback');
      expect(getLastPrompt(fallbackInstruction)).toContain(
        'Default route after invalid condition.',
      );
      expect(getLastPrompt(fallbackInstruction)).not.toContain('Invalid condition route.');
    });

    it('should retry extraction when parsed JSON does not match the edge output schema', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal validate planned output schema', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      const extractionInstruction = await agent.runner(
        createLlmResultContext(JSON.stringify({ goals: [{ name: 'missing-desc' }] })),
        state,
      );
      const prompt = getLastPrompt(extractionInstruction);

      expect(getGraphStore(state)?.plan).toBeUndefined();
      expect(expectCallLlm(extractionInstruction).stepLabel).toBe('plan:extract');
      expect(getGraphState(state)).toMatchObject({
        active: true,
        attempts: 1,
        currentNode: 'plan',
        phase: 'node_out',
      });
      expect(prompt).toContain('requires an output object that matches this schema');
      expect(prompt).toContain('goals');
      expect(prompt).toContain('desc');

      const goals = [{ desc: 'Recovered with a valid goal description.', name: 'valid-goal' }];
      const workInstruction = await agent.runner(
        createLlmResultContext(JSON.stringify({ goals })),
        state,
      );

      expect(getGraphStore(state)?.plan).toEqual({ goals });
      expect(expectCallLlm(workInstruction).stepLabel).toBe('work');
      expect(getLastPrompt(workInstruction)).toContain('Recovered with a valid goal description.');
    });

    it('should request fenced json extraction and commit recovered node output', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal add graph tests', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      const extractionInstruction = await agent.runner(
        createLlmResultContext('I found two goals, but I am not returning JSON yet.'),
        state,
      );

      expect(getGraphState(state)).toMatchObject({
        active: true,
        attempts: 1,
        currentNode: 'plan',
        phase: 'node_out',
      });
      expect(expectCallLlm(extractionInstruction).stepLabel).toBe('plan:extract');
      expect(getLastPrompt(extractionInstruction)).toContain(
        'markdown fenced code block tagged json',
      );
      expect(getLastPrompt(extractionInstruction)).toContain('output_schema');
      expect(getLastPrompt(extractionInstruction)).toContain('format_instruction');
      expect(getLastPrompt(extractionInstruction)).toContain('previous_error');

      const goals = [{ desc: 'Cover graph extraction retry.', name: 'test extraction' }];
      const workInstruction = await agent.runner(
        createLlmResultContext(`\`\`\`json\n${JSON.stringify({ goals })}\n\`\`\``),
        state,
      );

      expect(getGraphStore(state)?.plan).toEqual({ goals });
      expect(getGraphState(state)).toMatchObject({ currentNode: 'work', phase: 'node_in' });
      expect(expectCallLlm(workInstruction).stepLabel).toBe('work');
      expect(getLastPrompt(workInstruction)).toContain('Cover graph extraction retry.');
    });

    it('should stop the verify-to-work loop when maxTraversals is reached', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal keep iterating until verified', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      const goals = [{ desc: 'Iterate until the verifier accepts the work.', name: 'iterate' }];
      await agent.runner(createLlmResultContext(JSON.stringify({ goals })), state);

      for (let index = 1; index <= 3; index++) {
        await agent.runner(
          createLlmResultContext(JSON.stringify({ summary: `work attempt ${index}` })),
          state,
        );
        const reworkInstruction = await agent.runner(
          createLlmResultContext(
            JSON.stringify({
              review: {
                fin: false,
                unfinish: [{ desc: `attempt ${index} is still incomplete`, name: 'iterate' }],
              },
            }),
          ),
          state,
        );

        expect(getGraphStore(state)?.verify).toEqual({
          review: {
            fin: false,
            unfinish: [{ desc: `attempt ${index} is still incomplete`, name: 'iterate' }],
          },
        });
        expect(getGraphState(state)).toMatchObject({ currentNode: 'work', phase: 'node_in' });
        expect(expectCallLlm(reworkInstruction).stepLabel).toBe('work');
      }

      await agent.runner(
        createLlmResultContext(JSON.stringify({ summary: 'work attempt 4' })),
        state,
      );
      const result = await agent.runner(
        createLlmResultContext(
          JSON.stringify({
            review: {
              fin: false,
              unfinish: [{ desc: 'attempt 4 is still incomplete', name: 'iterate' }],
            },
          }),
        ),
        state,
      );

      expect(getGraphState(state)).toMatchObject({
        phase: 'fin',
        reason: 'error_recovery',
        reasonDetail: expect.stringContaining('graph_edge_limit_reached'),
      });
      expect(result).toMatchObject({
        reason: 'error_recovery',
        reasonDetail: expect.stringContaining('graph_edge_limit_reached'),
        type: 'finish',
      });
    });

    it('should commit raw output after extraction attempts are exhausted', async () => {
      const agent = new GraphAgent({
        agentConfig: { maxSteps: 100 },
        graph: loadGoalLoopGraph(),
        operationId: 'test-operation',
      });
      const state = createMockState({
        messages: [{ content: '/goal recover from bad planning output', role: 'user' }],
      });

      await agent.runner(createContext('init'), state);

      for (const content of ['not json', 'still not json', 'nope', 'final raw planning output']) {
        await agent.runner(createLlmResultContext(content), state);
      }

      expect(getGraphStore(state)?.plan).toEqual({
        _extractionError: 'The node output is not valid JSON.',
        _raw: 'final raw planning output',
      });
      expect(getGraphState(state)).toMatchObject({ currentNode: 'work', phase: 'node_in' });
    });
  });
});
