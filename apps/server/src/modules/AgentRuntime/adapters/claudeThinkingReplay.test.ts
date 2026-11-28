// @vitest-environment node
/**
 * Claude thinking replay, end to end at the payload layer.
 *
 * Every server step rebuilds its prompt from DB rows, so this drives the same
 * chain a real step runs: `parse` (assistant group folding) → context hints
 * (`resolveModelParams` replay gate) → `serverMessagesEngine` (group
 * flattening, message cleanup) → the Anthropic / Bedrock runtime payload
 * builder. Only the SDK call at the very end is mocked, and it is where the
 * request body is captured.
 *
 * Anthropic requires the signed thinking blocks of a tool-use turn to come
 * back unchanged; a missing block is not an error, it silently drops the
 * reasoning. So each step after the first must carry a `thinking` block,
 * byte-identical to the stored reasoning, ahead of that step's `tool_use`.
 * @see https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks
 */
import { InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import type { CallLLMPayload } from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import { LobeAnthropicAI, LobeBedrockAI } from '@lobechat/model-runtime';
import { anthropic as anthropicCards, bedrock as bedrockCards } from 'model-bank';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';

import type { RuntimeExecutorContext } from '../context';
import { resolveServerCallLlmContextHints } from './serverCallLlmContextHints';

const loadModelsMock = vi.hoisted(() => vi.fn());

vi.mock('@/business/client/model-bank/loadModels', () => ({ loadModels: loadModelsMock }));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    findByIdAndProvider = vi.fn().mockResolvedValue(undefined);
    getModelReasoningConfig = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  InvokeModelWithResponseStreamCommand: vi.fn(),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

const ANTHROPIC_MODEL = 'claude-opus-5-5';
const BEDROCK_MODEL = 'global.anthropic.claude-opus-5-5';

// Real-looking signatures: long opaque base64, as Anthropic returns them. The
// assertion is byte equality, so any truncation or re-encoding fails it.
const signature = (seed: string) =>
  `Eu${seed}${'QkGQYAiJAHnHRJG4nPBrdTlo6CmXoyE8WYoQ+/='.repeat(24)}`;
const SIG_STEP_1 = signature('step1');
const SIG_STEP_2 = signature('step2');
const SIG_PREV_TURN = signature('prev');

// The bundled model-bank cards, unmodified: neither declares `preserveThinking`.
const builtinCards = () => [
  ...anthropicCards.map((card) => ({ ...card, providerId: 'anthropic' })),
  ...bedrockCards.map((card) => ({ ...card, providerId: 'bedrock' })),
];

const ctx = {
  messageModel: {} as RuntimeExecutorContext['messageModel'],
  operationId: 'operation-1',
  serverDB: {} as RuntimeExecutorContext['serverDB'],
  stepIndex: 0,
  streamManager: {} as RuntimeExecutorContext['streamManager'],
  toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
  userId: 'user-1',
} satisfies RuntimeExecutorContext;

interface Source {
  model: string;
  provider: string;
}

const toolRow = (id: string, parentId: string, content: string, createdAt: number) => ({
  content,
  createdAt,
  id,
  parentId,
  plugin: { apiName: 'runCommand', arguments: '{}', identifier: 'sandbox', type: 'default' },
  role: 'tool',
  tool_call_id: id,
  updatedAt: createdAt,
});

const assistantToolRow = (
  id: string,
  parentId: string,
  toolId: string,
  args: string,
  reasoning: { content: string; signature: string },
  createdAt: number,
  source: Source,
) => ({
  content: '',
  createdAt,
  id,
  model: source.model,
  parentId,
  provider: source.provider,
  reasoning,
  role: 'assistant',
  tools: [
    {
      apiName: 'runCommand',
      arguments: args,
      id: toolId,
      identifier: 'sandbox',
      type: 'default',
    },
  ],
  updatedAt: createdAt,
});

/**
 * DB rows of one user turn that has run two tool-calling steps. Step 2's
 * request is built from the rows through `tool-1`, step 3's from all of them.
 */
const toolLoopRows = (source: Source) => [
  {
    content: 'The test suite is red. Find the failing test and fix it.',
    createdAt: 1000,
    id: 'user-1',
    role: 'user',
    updatedAt: 1000,
  },
  assistantToolRow(
    'assistant-1',
    'user-1',
    'tool-1',
    '{"command":"bun run test"}',
    { content: 'Run the suite first to see which test fails.', signature: SIG_STEP_1 },
    2000,
    source,
  ),
  toolRow('tool-1', 'assistant-1', 'FAIL src/sum.test.ts: expected 3, received 4', 3000),
  assistantToolRow(
    'assistant-2',
    'tool-1',
    'tool-2',
    '{"command":"cat src/sum.ts"}',
    { content: 'sum.test.ts fails; read the implementation next.', signature: SIG_STEP_2 },
    4000,
    source,
  ),
  toolRow('tool-2', 'assistant-2', 'export const sum = (a, b) => a + b + 1;', 5000),
];

const STEP_2_ROWS = 3;
const STEP_3_ROWS = 5;

/** Run the per-step context chain on DB rows and return the messages the runtime receives. */
const buildStepMessages = async (dbRows: unknown[], source: Source) => {
  const { flatList } = parse(dbRows as Parameters<typeof parse>[0]);
  const hints = await resolveServerCallLlmContextHints({
    ctx,
    llmPayload: { messages: flatList } as unknown as CallLLMPayload,
    model: source.model,
    provider: source.provider,
    world: { agent: { chatConfig: {} } },
  });
  const { messages } = await serverMessagesEngine({
    capabilities: hints.capabilities,
    messages: hints.messagesForContext,
    model: source.model,
    provider: source.provider,
    systemRole: 'You are a coding agent.',
  });
  return { hints, messages };
};

const TOOLS = [
  {
    function: {
      description: 'Run a shell command',
      name: 'sandbox____runCommand',
      parameters: { properties: { command: { type: 'string' } }, type: 'object' },
    },
    type: 'function' as const,
  },
];

const anthropicRequest = async (dbRows: unknown[]) => {
  const source = { model: ANTHROPIC_MODEL, provider: 'anthropic' };
  const { hints, messages } = await buildStepMessages(dbRows, source);
  const runtime = new LobeAnthropicAI({ apiKey: 'test' });
  const create = vi
    .spyOn(runtime['client'].messages, 'create')
    .mockResolvedValue(new ReadableStream() as any);

  await runtime.chat({
    messages: messages as any,
    model: ANTHROPIC_MODEL,
    preserveThinking: hints.preserveThinkingForPayload,
    temperature: 1,
    thinking: { type: 'adaptive' } as any,
    tools: TOOLS,
  });

  return { body: create.mock.calls[0][0] as any, hints };
};

const bedrockRequest = async (dbRows: unknown[]) => {
  const source = { model: BEDROCK_MODEL, provider: 'bedrock' };
  const { hints, messages } = await buildStepMessages(dbRows, source);
  const runtime = new LobeBedrockAI({
    accessKeyId: 'test-access-key-id',
    accessKeySecret: 'test-access-key-secret',
    region: 'us-west-2',
  });
  vi.spyOn(runtime['client'], 'send').mockResolvedValue(new ReadableStream() as any);

  await runtime.chat({
    messages: messages as any,
    model: BEDROCK_MODEL,
    preserveThinking: hints.preserveThinkingForPayload,
    temperature: 1,
    thinking: { type: 'adaptive' } as any,
    tools: TOOLS,
  });

  const command = (InvokeModelWithResponseStreamCommand as unknown as Mock).mock.calls.at(-1)![0];
  return { body: JSON.parse(command.body), hints };
};

type Block = { type: string; [key: string]: unknown };

const assistantTurns = (body: { messages: { content: Block[] | string; role: string }[] }) =>
  body.messages.filter((message) => message.role === 'assistant');

/** The assistant turn that issued `toolUseId`, as sent to the API. */
const turnFor = (body: Parameters<typeof assistantTurns>[0], toolUseId: string) => {
  const turn = assistantTurns(body).find(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === 'tool_use' && block.id === toolUseId),
  );
  expect(turn, `assistant turn issuing ${toolUseId}`).toBeDefined();
  return turn!.content as Block[];
};

const expectSignedThinkingBeforeToolUse = (
  content: Block[],
  toolUseId: string,
  reasoning: { content: string; signature: string },
) => {
  const thinkingIndex = content.findIndex((block) => block.type === 'thinking');
  const toolUseIndex = content.findIndex(
    (block) => block.type === 'tool_use' && block.id === toolUseId,
  );

  expect(thinkingIndex).toBeGreaterThanOrEqual(0);
  expect(thinkingIndex).toBeLessThan(toolUseIndex);
  expect(content[thinkingIndex]).toEqual({
    signature: reasoning.signature,
    thinking: reasoning.content,
    type: 'thinking',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  loadModelsMock.mockResolvedValue(builtinCards());
});

describe('Claude thinking replay across tool-calling steps', () => {
  it('ships the bundled Claude cards without a preserveThinking toggle', () => {
    const opus = builtinCards().filter((card) => card.id.endsWith('claude-opus-5-5'));

    expect(opus.map((card) => card.providerId).sort()).toEqual(['anthropic', 'bedrock']);
    for (const card of opus) {
      expect((card as { settings?: { extendParams?: string[] } }).settings?.extendParams).toEqual([
        'disableContextCaching',
      ]);
    }
  });

  describe.each([
    {
      name: 'anthropic',
      request: anthropicRequest,
      source: { model: ANTHROPIC_MODEL, provider: 'anthropic' },
    },
    {
      name: 'bedrock',
      request: bedrockRequest,
      source: { model: BEDROCK_MODEL, provider: 'bedrock' },
    },
  ])('$name', ({ request, source }) => {
    it('step 2 sends step 1 thinking, signature unchanged, ahead of its tool_use', async () => {
      const rows = toolLoopRows(source).slice(0, STEP_2_ROWS);
      const { body, hints } = await request(rows);

      expect(hints.shouldReplayAssistantReasoning).toBe(true);
      expectSignedThinkingBeforeToolUse(turnFor(body, 'tool-1'), 'tool-1', rows[1].reasoning!);
    });

    it('step 3 sends the thinking of both earlier steps, each ahead of its own tool_use', async () => {
      const rows = toolLoopRows(source).slice(0, STEP_3_ROWS);
      const { body } = await request(rows);

      expectSignedThinkingBeforeToolUse(turnFor(body, 'tool-1'), 'tool-1', rows[1].reasoning!);
      expectSignedThinkingBeforeToolUse(turnFor(body, 'tool-2'), 'tool-2', rows[3].reasoning!);

      const signatures = assistantTurns(body)
        .flatMap((turn) => (Array.isArray(turn.content) ? turn.content : []))
        .filter((block) => block.type === 'thinking')
        .map((block) => block.signature);
      expect(signatures).toEqual([SIG_STEP_1, SIG_STEP_2]);
    });

    it('keeps the request body free of the preserveThinking payload flag', async () => {
      const { body, hints } = await request(toolLoopRows(source).slice(0, STEP_3_ROWS));

      expect(hints.preserveThinkingForPayload).toBe(true);
      expect(body).not.toHaveProperty('preserveThinking');
      expect(body).not.toHaveProperty('preserve_thinking');
    });
  });

  it('replays an earlier finished turn and skips a DeepSeek turn in the same topic', async () => {
    const claude = { model: ANTHROPIC_MODEL, provider: 'anthropic' };
    const deepseek = { model: 'deepseek-v4-pro', provider: 'deepseek' };
    const DEEPSEEK_SIGNATURE = '340acffe-0000-4000-8000-000000000000';

    const rows = [
      { content: 'List the files.', createdAt: 100, id: 'u-a', role: 'user', updatedAt: 100 },
      assistantToolRow(
        'a-a',
        'u-a',
        'tool-a',
        '{"command":"ls"}',
        { content: 'List the workspace root.', signature: SIG_PREV_TURN },
        200,
        claude,
      ),
      toolRow('tool-a', 'a-a', 'src tests package.json', 300),
      {
        content: 'There are three entries.',
        createdAt: 400,
        id: 'a-a-final',
        model: claude.model,
        parentId: 'tool-a',
        provider: claude.provider,
        role: 'assistant',
        updatedAt: 400,
      },
      {
        content: 'Count the lines.',
        createdAt: 500,
        id: 'u-b',
        parentId: 'a-a-final',
        role: 'user',
        updatedAt: 500,
      },
      assistantToolRow(
        'a-b',
        'u-b',
        'tool-b',
        '{"command":"wc -l src/*"}',
        { content: 'DeepSeek reasoning', signature: DEEPSEEK_SIGNATURE },
        600,
        deepseek,
      ),
      toolRow('tool-b', 'a-b', '42 total', 700),
      {
        content: '42 lines.',
        createdAt: 800,
        id: 'a-b-final',
        model: deepseek.model,
        parentId: 'tool-b',
        provider: deepseek.provider,
        role: 'assistant',
        updatedAt: 800,
      },
      {
        content: 'Now fix the bug.',
        createdAt: 900,
        id: 'u-c',
        parentId: 'a-b-final',
        role: 'user',
        updatedAt: 900,
      },
    ];

    const { body } = await anthropicRequest(rows);

    expectSignedThinkingBeforeToolUse(turnFor(body, 'tool-a'), 'tool-a', rows[1].reasoning!);

    const deepseekTurn = turnFor(body, 'tool-b');
    expect(deepseekTurn.some((block) => block.type === 'thinking')).toBe(false);
    expect(JSON.stringify(body)).not.toContain(DEEPSEEK_SIGNATURE);
    expect(JSON.stringify(body)).not.toContain('DeepSeek reasoning');
  });
});
