import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import OpenAI from 'openai';

const baseUrl = process.env.MCP_APP_MODEL_BASE_URL ?? 'http://127.0.0.1:39743/v1';
const logPath = process.env.MCP_APP_MODEL_LOG ?? '/tmp/mcp-apps-model-requests.jsonl';
const client = new OpenAI({ apiKey: 'local-fixture-key', baseURL: baseUrl });
const call = async (messages: OpenAI.ChatCompletionMessageParam[], tools: any[] = []) => {
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

const apiName = 'fixture_inline_preference';
const hash = createHash('md5').update(apiName).digest('hex').slice(0, 12);
for (const name of [`fixture____${apiName}____mcp`, `fixture____MD5HASH_${hash}____mcp`]) {
  const tools = [{ type: 'function', function: { name, parameters: { type: 'object' } } }];
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'user', content: `Please call ${apiName}` },
  ];
  const first = await call(messages, tools);
  const tool = first.flatMap(({ choices }) => choices[0]?.delta.tool_calls ?? [])[0];
  assert.equal(tool?.function?.name, name, 'must return the actual advertised tool name');
  const next = await call(
    [
      ...messages,
      {
        role: 'assistant',
        tool_calls: [{ id: tool!.id!, type: 'function', function: { name, arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: tool!.id!, content: 'fixture result' },
    ],
    tools,
  );
  assert.equal(
    next.at(-1)?.choices[0]?.finish_reason,
    'stop',
    'must not invoke the same tool indefinitely',
  );
}

const capsName = 'fixture_app_inline_only_caps';
const capsStream = await call(
  [{ role: 'user', content: `Please call ${capsName}` }],
  [{ type: 'function', function: { name: capsName, parameters: { type: 'object' } } }],
);
assert.equal(
  capsStream.flatMap(({ choices }) => choices[0]?.delta.tool_calls ?? [])[0]?.function?.name,
  capsName,
);
const multi = await call(
  [{ role: 'user', content: `Call ${apiName}, ${capsName}, ${apiName}, and fixture_not_offered` }],
  [apiName, capsName].map((name) => ({
    type: 'function',
    function: { name, parameters: { type: 'object' } },
  })),
);
const multiCalls = multi.flatMap(({ choices }) => choices[0]?.delta.tool_calls ?? []);
assert.deepEqual(
  multiCalls.map((tool) => tool.function?.name),
  [apiName, capsName],
);
assert.equal(new Set(multiCalls.map((tool) => tool.id)).size, 2);

const log = (await readFile(logPath, 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.equal(log.length, 8);
assert.ok(
  log[0].request.tools.some((tool: any) => tool.function.name === 'fixture_inline_preference'),
);
assert.ok(JSON.stringify(log[1].request.messages).includes(contextMarker));
console.log(
  'Local model fixture smoke passed (bare/namespaced/hashed names, caps, multiple calls, post-tool stop, context echo, request audit).',
);
