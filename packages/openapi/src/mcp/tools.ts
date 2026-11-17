import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { ApiKeyScope } from '@/const/apiKeyScope';
import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { AgentService } from '../services/agent.service';
import { FileUploadService } from '../services/file.service';
import { KnowledgeBaseService } from '../services/knowledge-base.service';
import { MessageService } from '../services/message.service';
import { RunRestService } from '../services/run.service';
import { TopicService } from '../services/topic.service';
import type { Run } from '../types/run.type';
import { TERMINAL_RUN_STATUSES } from '../types/run.type';
import type { McpCallContext } from './context';
import { namedError } from './context';

/**
 * One MCP tool, bound to the same service, scopes and RBAC permissions as the
 * REST route it mirrors. Tools call the openapi service layer directly — never
 * the HTTP API — so behaviour, ownership checks and workspace isolation are
 * the REST API's own.
 */
export interface McpToolDefinition<Input extends z.ZodObject = z.ZodObject> {
  annotations: ToolAnnotations;
  description: string;
  inputSchema: Input;
  name: string;
  /** RBAC permission groups; each needs one granted code (the REST route's gate). */
  permissions: readonly (readonly string[])[];
  run: (ctx: McpCallContext, input: z.infer<Input>) => Promise<unknown>;
  /** API key scopes the tool needs, all of them. Keys without them never see the tool. */
  scopes: readonly ApiKeyScope[];
  title: string;
}

const defineTool = <Input extends z.ZodObject>(tool: McpToolDefinition<Input>) =>
  tool as unknown as McpToolDefinition;

const pick = <T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]])) as Pick<
    T,
    K
  >;

const READ_ONLY: ToolAnnotations = { openWorldHint: false, readOnlyHint: true };

const limit = (max: number, fallback: number) =>
  z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(fallback)
    .describe(`How many to return, 1–${max}. Defaults to ${fallback}.`);

const keyword = z.string().trim().max(100).optional();

const AGENT_READ = getScopePermissions('AGENT_READ', ['ALL', 'OWNER']);
const TOPIC_READ = getAllScopePermissions('TOPIC_READ');
const MESSAGE_READ = getAllScopePermissions('MESSAGE_READ');
const MESSAGE_CREATE = getAllScopePermissions('MESSAGE_CREATE');
const FILE_READ = getAllScopePermissions('FILE_READ');
const FILE_UPLOAD = getAllScopePermissions('FILE_UPLOAD');
const KNOWLEDGE_BASE_READ = getAllScopePermissions('KNOWLEDGE_BASE_READ');

const AGENT_SUMMARY_FIELDS = [
  'id',
  'title',
  'description',
  'avatar',
  'model',
  'provider',
  'updatedAt',
] as const;

const MESSAGE_FIELDS = [
  'id',
  'role',
  'content',
  'createdAt',
  'agentId',
  'model',
  'topicId',
  'threadId',
] as const;

/** Statuses a run can stop at for now: finished, or waiting on a person / tool results. */
const isSettled = (run: Run) => run.status !== 'queued' && run.status !== 'running';

const RUN_POLL_INTERVAL_MS = 500;

const summarizeRun = (run: Run) => ({
  completedAt: run.completedAt,
  cost: run.cost,
  error: run.error,
  id: run.id,
  pendingInterventionCount: run.pendingInterventionCount,
  result: run.result,
  status: run.status,
  topicId: run.topicId,
});

/** Read a topic and its latest `messageLimit` messages, oldest first. */
export const readTopic = async (ctx: McpCallContext, topicId: string, messageLimit: number) => {
  const topic = await new TopicService(ctx.db, ctx.userId, ctx.workspaceId).getTopicById(topicId);
  const messageService = new MessageService(ctx.db, ctx.userId, ctx.workspaceId);
  // The service pages oldest first; a long conversation is read from its tail.
  let { messages, total } = await messageService.getMessages({ limit: messageLimit, topicId });
  if (total > messageLimit) {
    ({ messages, total } = await messageService.getMessages({
      limit: messageLimit,
      offset: total - messageLimit,
      topicId,
    }));
  }
  return {
    messages: messages.map((message) => pick(message, MESSAGE_FIELDS)),
    messageTotal: total,
    topic: pick(topic, [
      'id',
      'title',
      'agentId',
      'groupId',
      'createdAt',
      'updatedAt',
      'messageCount',
    ]),
  };
};

export const listAgents = async (
  ctx: McpCallContext,
  query: { keyword?: string; limit: number },
) => {
  const { agents, total } = await new AgentService(ctx.db, ctx.userId, ctx.workspaceId).queryAgents(
    query,
  );
  return { agents: agents.map((agent) => pick(agent, AGENT_SUMMARY_FIELDS)), total };
};

export const MCP_TOOLS: McpToolDefinition[] = [
  defineTool({
    annotations: READ_ONLY,
    description:
      'List the agents you can run in LobeHub, newest first. Filter by a keyword in the title. Use an `id` from here with `run_agent`.',
    inputSchema: z.object({ keyword, limit: limit(100, 20) }),
    name: 'list_agents',
    permissions: [AGENT_READ],
    run: (ctx, input) => listAgents(ctx, input),
    scopes: ['agent:read'],
    title: 'List agents',
  }),
  defineTool({
    annotations: READ_ONLY,
    description:
      "Get one agent's full configuration: system prompt, model, provider, plugins and opening message.",
    inputSchema: z.object({ agentId: z.string().min(1) }),
    name: 'get_agent',
    permissions: [AGENT_READ],
    run: async (ctx, { agentId }) => {
      const agent = await new AgentService(ctx.db, ctx.userId, ctx.workspaceId).getAgentById(
        agentId,
      );
      if (!agent) throw namedError('NotFoundError', `Agent ${agentId} not found`);
      return agent;
    },
    scopes: ['agent:read'],
    title: 'Get an agent',
  }),
  defineTool({
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description:
      "Send a message to a LobeHub agent and run it, as the agent's own conversation (a topic). Waits up to `waitSeconds` for the reply: a finished run returns its `result.content`; a run still going returns its `id` and `status` — poll it with `get_run`. Pass `topicId` to continue an earlier conversation. Tool calls that would need a person's approval run without asking, and questions to the user are declined.",
    inputSchema: z.object({
      agentId: z.string().min(1).describe('The agent to run (see `list_agents`).'),
      fileIds: z
        .array(z.string().min(1))
        .max(50)
        .optional()
        .describe('Files already uploaded with `upload_file` to attach.'),
      input: z.string().min(1).describe('The message to send.'),
      topicId: z.string().min(1).optional().describe('Continue this conversation.'),
      waitSeconds: z
        .number()
        .int()
        .min(0)
        .max(120)
        .default(50)
        .describe('How long to wait for the reply before returning the run id. 0 returns at once.'),
    }),
    name: 'run_agent',
    permissions: [MESSAGE_CREATE],
    run: async (ctx, { agentId, fileIds, input, topicId, waitSeconds }) => {
      const service = new RunRestService(ctx.db, ctx.userId, ctx.workspaceId);
      const started = await service.createRun({ agentId, fileIds, input, topicId });
      const runId = started.id!;

      const deadline = Date.now() + waitSeconds * 1000;
      let run = await service.getRun(runId);
      while (!isSettled(run) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
        run = await service.getRun(runId);
      }
      return summarizeRun(run);
    },
    scopes: ['run:write', 'model:invoke'],
    title: 'Run an agent',
  }),
  defineTool({
    annotations: READ_ONLY,
    description: `Status of a run started with \`run_agent\`, with its reply once \`completed\`. Final statuses: ${TERMINAL_RUN_STATUSES.join(', ')}.`,
    inputSchema: z.object({ runId: z.string().min(1) }),
    name: 'get_run',
    permissions: [MESSAGE_READ],
    run: async (ctx, { runId }) =>
      summarizeRun(await new RunRestService(ctx.db, ctx.userId, ctx.workspaceId).getRun(runId)),
    scopes: ['run:read'],
    title: 'Get a run',
  }),
  defineTool({
    annotations: READ_ONLY,
    description:
      'Find conversations (topics) by a keyword in their title, newest first; narrow to one agent with `agentId`. Read one with `get_topic`.',
    inputSchema: z.object({
      agentId: z.string().min(1).optional(),
      keyword,
      limit: limit(100, 20),
    }),
    name: 'search_topics',
    permissions: [TOPIC_READ],
    run: async (ctx, { agentId, keyword, limit }) => {
      const { topics, total } = await new TopicService(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).getTopics({ agentId, keyword, limit });
      return {
        topics: topics.map((topic) =>
          pick(topic, ['id', 'title', 'agentId', 'groupId', 'messageCount', 'updatedAt']),
        ),
        total,
      };
    },
    scopes: ['chat:read'],
    title: 'Search topics',
  }),
  defineTool({
    annotations: READ_ONLY,
    description:
      'Read a conversation (topic): its title and its latest `messageLimit` messages, oldest first (`messageTotal` counts them all).',
    inputSchema: z.object({ messageLimit: limit(100, 50), topicId: z.string().min(1) }),
    name: 'get_topic',
    permissions: [TOPIC_READ, MESSAGE_READ],
    run: (ctx, { messageLimit, topicId }) => readTopic(ctx, topicId, messageLimit),
    scopes: ['chat:read'],
    title: 'Read a topic',
  }),
  defineTool({
    annotations: READ_ONLY,
    description:
      'Search message text across every conversation you can read. Each hit names its `topicId`; read the whole conversation with `get_topic`.',
    inputSchema: z.object({
      keyword: z.string().trim().min(1).max(100),
      limit: limit(100, 20),
    }),
    name: 'search_messages',
    permissions: [MESSAGE_READ],
    run: async (ctx, { keyword, limit }) => {
      const messages = await new MessageService(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).searchMessagesByKeyword({ keyword, limit });
      return { messages: messages.map((message) => pick(message, MESSAGE_FIELDS)) };
    },
    scopes: ['chat:read'],
    title: 'Search messages',
  }),
  defineTool({
    annotations: READ_ONLY,
    description:
      'List your files, newest first; filter by a keyword in the name or by knowledge base.',
    inputSchema: z.object({
      keyword,
      knowledgeBaseId: z.string().min(1).optional(),
      limit: limit(100, 20),
    }),
    name: 'list_files',
    permissions: [FILE_READ],
    run: async (ctx, { keyword, knowledgeBaseId, limit }) => {
      const { files, total } = await new FileUploadService(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).getFileList({ keyword, knowledgeBaseId, limit });
      return {
        files: files.map((file) => pick(file, ['id', 'name', 'fileType', 'size', 'updatedAt'])),
        total,
      };
    },
    scopes: ['file:read'],
    title: 'List files',
  }),
  defineTool({
    annotations: READ_ONLY,
    description:
      'Read a file: its details, a download URL, and — for documents — the parsed text (cut at `maxChars`). Images return the URL only.',
    inputSchema: z.object({
      fileId: z.string().min(1),
      maxChars: z.number().int().min(1).max(200_000).default(20_000),
    }),
    name: 'read_file',
    permissions: [FILE_READ],
    run: async (ctx, { fileId, maxChars }) => {
      const { file, parsed } = await new FileUploadService(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).getFileDetail(fileId);
      const content = parsed?.content;
      return {
        content: content?.slice(0, maxChars) ?? null,
        file: pick(file, ['id', 'name', 'fileType', 'size', 'url', 'createdAt', 'updatedAt']),
        parseError: parsed?.error ?? null,
        truncated: !!content && content.length > maxChars,
      };
    },
    scopes: ['file:read'],
    title: 'Read a file',
  }),
  defineTool({
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      'Upload a file to LobeHub, as plain `text` or as base64 `data`. Optionally add it to a knowledge base. Returns the file id to pass to `run_agent` or `read_file`.',
    inputSchema: z.object({
      data: z.string().min(1).optional().describe('File content, base64-encoded.'),
      knowledgeBaseId: z.string().min(1).optional(),
      mimeType: z.string().min(1).max(255).default('text/plain'),
      name: z.string().trim().min(1).max(255).describe('File name, with its extension.'),
      text: z.string().min(1).optional().describe('File content as UTF-8 text.'),
    }),
    name: 'upload_file',
    permissions: [FILE_UPLOAD],
    run: async (ctx, { data, knowledgeBaseId, mimeType, name, text }) => {
      if ((text === undefined) === (data === undefined)) {
        throw namedError('ValidationError', 'Pass exactly one of `text` or `data`');
      }
      const body = text === undefined ? Buffer.from(data!, 'base64') : Buffer.from(text, 'utf8');
      const { file } = await new FileUploadService(ctx.db, ctx.userId, ctx.workspaceId).uploadFile(
        new File([body], name, { type: mimeType }),
        { knowledgeBaseId },
      );
      return { file: pick(file, ['id', 'name', 'fileType', 'size', 'url', 'createdAt']) };
    },
    scopes: ['file:write'],
    title: 'Upload a file',
  }),
  defineTool({
    annotations: READ_ONLY,
    description: 'List the knowledge bases you can read; filter by a keyword in the name.',
    inputSchema: z.object({ keyword, limit: limit(100, 20) }),
    name: 'list_knowledge_bases',
    permissions: [KNOWLEDGE_BASE_READ],
    run: async (ctx, { keyword, limit }) => {
      const { knowledgeBases, total } = await new KnowledgeBaseService(
        ctx.db,
        ctx.userId,
        ctx.workspaceId,
      ).getKnowledgeBaseList({ keyword, limit });
      return {
        knowledgeBases: knowledgeBases.map((kb) =>
          pick(kb, ['id', 'name', 'description', 'accessType', 'updatedAt']),
        ),
        total,
      };
    },
    scopes: ['knowledge:read'],
    title: 'List knowledge bases',
  }),
];
