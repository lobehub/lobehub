import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/server';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import type { McpCallContext } from './context';
import { allowsScopes, assertPermissions, describeToolError } from './context';
import { listAgents, MCP_TOOLS, readTopic } from './tools';

export const LOBEHUB_MCP_SERVER_NAME = 'lobehub';

const INSTRUCTIONS = `LobeHub is a workspace of AI agents. Use these tools to find an agent (list_agents) and run it (run_agent), to look through past conversations (search_topics, search_messages, get_topic), and to work with files and knowledge bases. A run that is still going when run_agent returns can be polled with get_run.`;

const AGENT_READ = getScopePermissions('AGENT_READ', ['ALL', 'OWNER']);
const TOPIC_READ = getAllScopePermissions('TOPIC_READ');
const MESSAGE_READ = getAllScopePermissions('MESSAGE_READ');

const RESOURCE_LIST_LIMIT = 50;
const TOPIC_RESOURCE_MESSAGES = 100;

const json = (value: unknown) => JSON.stringify(value, null, 2);

const jsonResource = (uri: URL, value: unknown): ReadResourceResult => ({
  contents: [{ mimeType: 'application/json', text: json(value), uri: uri.href }],
});

/**
 * Build the MCP server one request is answered with. It is per request (the
 * endpoint is stateless), so every capability is decided up front from the
 * caller's credential: an API key only sees the tools, resources and prompts
 * its scopes reach. Each call then re-checks the caller's RBAC with the
 * permission codes of the REST route the capability mirrors.
 */
export const createLobeHubMcpServer = (ctx: McpCallContext, version: string): McpServer => {
  const server = new McpServer(
    { name: LOBEHUB_MCP_SERVER_NAME, title: 'LobeHub', version },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of MCP_TOOLS) {
    if (!allowsScopes(ctx, tool.scopes)) continue;

    server.registerTool(
      tool.name,
      {
        annotations: tool.annotations,
        description: tool.description,
        inputSchema: tool.inputSchema,
        title: tool.title,
      },
      async (input: unknown): Promise<CallToolResult> => {
        try {
          await assertPermissions(ctx, tool.permissions);
          const result = await tool.run(ctx, input as never);
          return {
            content: [{ text: json(result), type: 'text' }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          return { content: [{ text: describeToolError(error), type: 'text' }], isError: true };
        }
      },
    );
  }

  if (allowsScopes(ctx, ['agent:read'])) {
    server.registerResource(
      'agents',
      'lobehub://agents',
      {
        description: 'The agents you can run, newest first.',
        mimeType: 'application/json',
        title: 'Agents',
      },
      async (uri) => {
        await assertPermissions(ctx, [AGENT_READ]);
        return jsonResource(uri, await listAgents(ctx, { limit: RESOURCE_LIST_LIMIT }));
      },
    );

    server.registerResource(
      'agent',
      new ResourceTemplate('lobehub://agents/{agentId}', {
        list: async () => {
          await assertPermissions(ctx, [AGENT_READ]);
          const { agents } = await listAgents(ctx, { limit: RESOURCE_LIST_LIMIT });
          return {
            resources: agents.map((agent) => ({
              description: agent.description ?? undefined,
              mimeType: 'application/json',
              name: agent.title || agent.id,
              uri: `lobehub://agents/${agent.id}`,
            })),
          };
        },
      }),
      {
        description: "One agent's configuration.",
        mimeType: 'application/json',
        title: 'Agent',
      },
      async (uri, { agentId }) => {
        await assertPermissions(ctx, [AGENT_READ]);
        const tool = MCP_TOOLS.find(({ name }) => name === 'get_agent')!;
        return jsonResource(uri, await tool.run(ctx, { agentId: String(agentId) }));
      },
    );
  }

  if (allowsScopes(ctx, ['chat:read'])) {
    server.registerResource(
      'topic',
      new ResourceTemplate('lobehub://topics/{topicId}', {
        list: async () => {
          await assertPermissions(ctx, [TOPIC_READ]);
          const searchTopics = MCP_TOOLS.find(({ name }) => name === 'search_topics')!;
          const { topics } = (await searchTopics.run(ctx, { limit: RESOURCE_LIST_LIMIT })) as {
            topics: { id: string; title?: string | null }[];
          };
          return {
            resources: topics.map((topic) => ({
              mimeType: 'application/json',
              name: topic.title || topic.id,
              uri: `lobehub://topics/${topic.id}`,
            })),
          };
        },
      }),
      {
        description: 'A conversation and its messages, oldest first.',
        mimeType: 'application/json',
        title: 'Topic',
      },
      async (uri, { topicId }) => {
        await assertPermissions(ctx, [TOPIC_READ, MESSAGE_READ]);
        return jsonResource(uri, await readTopic(ctx, String(topicId), TOPIC_RESOURCE_MESSAGES));
      },
    );

    server.registerPrompt(
      'summarize_topic',
      {
        argsSchema: z.object({
          topicId: z.string().min(1).describe('The conversation to summarize.'),
        }),
        description:
          'Summarize a LobeHub conversation: its decisions, open questions and next steps.',
        title: 'Summarize a conversation',
      },
      async ({ topicId }) => {
        await assertPermissions(ctx, [TOPIC_READ, MESSAGE_READ]);
        const topic = await readTopic(ctx, topicId, TOPIC_RESOURCE_MESSAGES);
        return {
          messages: [
            {
              content: {
                text: `Summarize this LobeHub conversation: the decisions made, the open questions, and the next steps.\n\n${json(topic)}`,
                type: 'text',
              },
              role: 'user',
            },
          ],
        };
      },
    );
  }

  return server;
};
