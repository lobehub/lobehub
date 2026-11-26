import { appendFile } from 'node:fs/promises';

import { McpServer, UrlElicitationRequiredError } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const server = new McpServer({ name: 'legacy-elicitation-stdio', version: '1.0.0' });
server.registerTool('form', { description: 'Two legacy stdio rounds' }, async (ctx) => {
  if (process.env.ELICITATION_LEDGER)
    await appendFile(
      process.env.ELICITATION_LEDGER,
      JSON.stringify({ event: 'started', tool: 'form', id: ctx.mcpReq.id, time: Date.now() }) +
        '\n',
    );
  let response;
  for (let round = 1; round <= 2; round++) {
    response = await ctx.mcpReq.elicitInput(
      {
        mode: 'form',
        message: `Round ${round}`,
        requestedSchema: {
          type: 'object',
          properties: { label: { type: 'string' } },
          required: ['label'],
        },
      },
      { relatedRequestId: ctx.mcpReq.id },
    );
    if (response.action !== 'accept') break;
  }
  if (response.action === 'accept' && process.env.ELICITATION_LEDGER)
    await appendFile(
      process.env.ELICITATION_LEDGER,
      JSON.stringify({ event: 'applied', tool: 'form', id: ctx.mcpReq.id, time: Date.now() }) +
        '\n',
    );
  return {
    content: [
      {
        type: 'text',
        text: response.action === 'accept' ? `saved:${response.content.label}` : response.action,
      },
    ],
  };
});
server.registerTool('url', { description: 'URL from legacy stdio' }, async (ctx) => {
  const response = await ctx.mcpReq.elicitInput(
    {
      mode: 'url',
      elicitationId: 'stdio-url',
      message: 'Open the external demo',
      url: process.env.ELICITATION_URL || 'https://example.com/demo',
    },
    { relatedRequestId: ctx.mcpReq.id },
  );
  if (process.env.ELICITATION_URL && response.action === 'accept') {
    const target = new URL(process.env.ELICITATION_URL);
    const status = await (await fetch(`${target.origin}/external-status/stdio-url`)).json();
    if (!status.status)
      throw new UrlElicitationRequiredError([
        {
          mode: 'url',
          elicitationId: 'stdio-url',
          message: 'Finish the external operation, then return.',
          url: target.href,
        },
      ]);
    if (status.status === 'failure')
      return { content: [{ type: 'text', text: 'url:external failure' }], isError: true };
    await fetch(`${target.origin}/effect/stdio-url`, { method: 'POST' });
    return { content: [{ type: 'text', text: 'url:completed' }] };
  }
  return { content: [{ type: 'text', text: `url:${response.action}` }] };
});
await server.connect(new StdioServerTransport());
