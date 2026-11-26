/**
 * Request / response examples for the core resources' operations, published
 * in the spec through `routeDoc({ requestExample, responseExample })`.
 *
 * Every example is checked against its schema (requests here through
 * `example()`, responses inside `routeDoc`), and the spec build fails on a
 * mismatch, so the documentation cannot drift from the payload it describes.
 */
import type { z } from 'zod';

import type { RequestExample } from './openapi';

/** Pair `value` with its schema check for `routeDoc({ requestExample })`. */
export const example = <T extends z.ZodType>(schema: T, value: z.input<T>): RequestExample => {
  const result = schema.safeParse(value);
  return result.success
    ? { value }
    : { error: `requestExample does not match its schema: ${result.error.message}`, value };
};

const createdAt = '2026-01-15T08:30:00.000Z';
const updatedAt = '2026-01-15T09:12:00.000Z';

export const AGENT_EXAMPLE = {
  agencyConfig: null,
  avatar: '🧑‍💻',
  chatConfig: { enableHistoryCount: true, historyCount: 20 },
  createdAt,
  description: 'Reviews pull requests and explains the risky parts.',
  id: 'agt_6sQwJ3dVbX1m',
  model: 'gpt-5.1',
  params: { temperature: 0.3 },
  personal: false,
  plugins: [{ identifier: 'lobe-web-browsing', mode: 'auto' as const }],
  provider: 'openai',
  slug: 'code-reviewer',
  systemRole: 'You are a meticulous senior code reviewer.',
  title: 'Code Reviewer',
  updatedAt,
};

export const CREATE_AGENT_EXAMPLE = {
  description: 'Reviews pull requests and explains the risky parts.',
  model: 'gpt-5.1',
  provider: 'openai',
  systemRole: 'You are a meticulous senior code reviewer.',
  title: 'Code Reviewer',
};

export const AGENT_LIST_EXAMPLE = {
  agents: [AGENT_EXAMPLE],
  hasMore: true,
  nextCursor: 'eyJpZCI6ImFndF82c1F3SjNkVmJYMW0ifQ',
  total: 42,
};

const TOPIC_SUMMARY_EXAMPLE = {
  agentId: AGENT_EXAMPLE.id,
  completedAt: null,
  content: null,
  cost: null,
  createdAt,
  description: null,
  favorite: false,
  groupId: null,
  historySummary: null,
  id: 'tpc_Hk2vX9pQe4Ls',
  metadata: null,
  mode: null,
  model: 'gpt-5.1',
  provider: 'openai',
  sessionId: null,
  status: 'active' as const,
  title: 'Review PR #1234',
  totalCost: 0.0123,
  totalInputTokens: 1830,
  totalOutputTokens: 412,
  totalTokens: 2242,
  trigger: null,
  updatedAt,
  usage: null,
};

export const TOPIC_EXAMPLE = {
  ...TOPIC_SUMMARY_EXAMPLE,
  messageCount: 6,
  user: {
    avatar: null,
    createdAt,
    email: 'ada@example.com',
    firstName: 'Ada',
    fullName: 'Ada Lovelace',
    id: 'user_2Nf8sLq0aT',
    isOnboarded: true,
    lastName: 'Lovelace',
    phone: null,
    updatedAt,
    username: 'ada',
  },
};

export const CREATE_TOPIC_EXAMPLE = { agentId: AGENT_EXAMPLE.id, title: 'Review PR #1234' };

export const TOPIC_LIST_EXAMPLE = {
  hasMore: false,
  nextCursor: null,
  topics: [TOPIC_EXAMPLE],
  total: 1,
};

export const MESSAGE_EXAMPLE = {
  agentId: AGENT_EXAMPLE.id,
  content: 'What changed in the auth middleware?',
  createdAt,
  error: null,
  favorite: false,
  files: [],
  groupId: null,
  id: 'msg_Qm4c8VtYw2Rz',
  messageGroupId: null,
  metadata: null,
  model: null,
  observationId: null,
  parentId: null,
  provider: null,
  quotaId: null,
  reasoning: null,
  role: 'user',
  search: null,
  session: null,
  sessionId: null,
  summary: null,
  targetId: null,
  threadId: null,
  tools: null,
  topic: TOPIC_SUMMARY_EXAMPLE,
  topicId: TOPIC_SUMMARY_EXAMPLE.id,
  traceId: null,
  updatedAt,
  usage: null,
};

export const CREATE_MESSAGE_EXAMPLE = {
  agentId: AGENT_EXAMPLE.id,
  content: 'What changed in the auth middleware?',
  role: 'user' as const,
  topicId: TOPIC_SUMMARY_EXAMPLE.id,
};

export const MESSAGE_LIST_EXAMPLE = {
  hasMore: false,
  messages: [MESSAGE_EXAMPLE],
  nextCursor: null,
  total: 1,
};

export const FILE_LIST_EXAMPLE = {
  files: [
    {
      chunking: null,
      createdAt,
      embedding: null,
      fileType: 'application/pdf',
      id: 'file_Lw7pD3kXa9Ue',
      knowledgeBases: [],
      metadata: null,
      name: 'architecture.pdf',
      parentId: null,
      size: 482_133,
      source: null,
      updatedAt,
      url: 'https://files.example.com/architecture.pdf',
      users: [],
      visibility: 'private' as const,
    },
  ],
  hasMore: false,
  nextCursor: null,
  total: 1,
  totalSize: '482133',
};

const FILE_EXAMPLE = {
  createdAt,
  fileType: 'application/pdf',
  id: 'file_Lw7pD3kXa9Ue',
  metadata: null,
  name: 'architecture.pdf',
  parentId: null,
  size: 482_133,
  source: null,
  updatedAt,
  url: 'https://files.example.com/architecture.pdf',
  visibility: 'private' as const,
};

export const QUERY_FILES_EXAMPLE = { fileIds: [FILE_EXAMPLE.id, 'file_missing0000'] };

export const QUERY_FILES_RESULT_EXAMPLE = {
  failed: [{ error: 'File not found', fileId: 'file_missing0000' }],
  files: [{ file: FILE_EXAMPLE }],
  success: 1,
  total: 2,
};

export const CREATE_RESPONSE_EXAMPLE = {
  input: 'Summarize the open review comments on PR #1234.',
  model: AGENT_EXAMPLE.id,
};

export const RESPONSE_EXAMPLE = {
  background: false,
  completed_at: 1_768_465_821,
  created_at: 1_768_465_800,
  error: null,
  frequency_penalty: 0,
  id: 'resp_tpc_Hk2vX9pQe4Ls',
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  max_tool_calls: null,
  metadata: {},
  model: AGENT_EXAMPLE.id,
  object: 'response' as const,
  output: [
    {
      content: [
        {
          annotations: [],
          logprobs: [],
          text: 'Two comments are still open: a missing null check and a flaky test.',
          type: 'output_text' as const,
        },
      ],
      id: 'msg_Zt5n1KcBv8Qp',
      role: 'assistant' as const,
      status: 'completed' as const,
      type: 'message' as const,
    },
  ],
  output_text: 'Two comments are still open: a missing null check and a flaky test.',
  parallel_tool_calls: true,
  presence_penalty: 0,
  previous_response_id: null,
  prompt_cache_key: null,
  reasoning: null,
  safety_identifier: null,
  service_tier: 'default',
  status: 'completed' as const,
  store: true,
  temperature: 1,
  text: { format: { type: 'text' as const } },
  tool_choice: 'auto' as const,
  tools: [],
  top_logprobs: 0,
  top_p: 1,
  truncation: 'disabled' as const,
  usage: {
    input_tokens: 1830,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 412,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2242,
  },
  user: null,
};
