import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import OpenAI from 'openai';

const baseUrl = process.env.MCP_APP_MODEL_BASE_URL ?? 'http://127.0.0.1:39743/v1';
const logPath = process.env.MCP_APP_MODEL_LOG ?? '/tmp/mcp-apps-model-requests.jsonl';
const client = new OpenAI({ apiKey: 'local-fixture-key', baseURL: baseUrl });
const call = async (messages: Array<{ role: 'user'; content: string }>, tools: any[] = []) => {
  const stream = await client.chat.completions.create({
    model: 'mcp-apps-fixture',
    stream: true,
    messages,
    tools,
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
};

const toolStream = await call(
  [{ role: 'user', content: 'Please call fixture_inline_preference' }],
  [
    {
      type: 'function',
      function: {
        name: 'fixture_inline_preference',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],
);
assert.equal(toolStream.at(-1)?.choices[0]?.finish_reason, 'tool_calls');
assert.equal(
  toolStream.flatMap(({ choices }) => choices[0]?.delta.tool_calls ?? [])[0]?.function?.name,
  'fixture_inline_preference',
);

const contextMarker = 'MCP_APPS_CONTEXT_ONCE__amber-kite-42';
const contextStream = await call([{ role: 'user', content: `Context marker: ${contextMarker}` }]);
assert.ok(contextStream.some(({ choices }) => choices[0]?.delta.content?.includes(contextMarker)));

const log = (await readFile(logPath, 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.equal(log.length, 2);
assert.ok(
  log[0].request.tools.some((tool: any) => tool.function.name === 'fixture_inline_preference'),
);
assert.ok(JSON.stringify(log[1].request.messages).includes(contextMarker));
console.log('Local model fixture smoke passed (tool call, context echo, request audit).');
