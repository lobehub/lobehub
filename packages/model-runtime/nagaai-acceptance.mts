// Acceptance run of the NagaAI runtime against the live API (not committed).
import { LobeNagaAI } from './src/providers/nagaai/index';

const runtime = new LobeNagaAI({ apiKey: process.env.NAGA_API_KEY });
const sent: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  sent.push(`${init?.method ?? 'GET'} ${typeof input === 'string' ? input : input.url}`);
  return realFetch(input, init);
}) as typeof fetch;
const OpenAI = (await import("openai")).default;
const orig = (OpenAI as any).prototype.buildRequest ?? null;
if (orig) (OpenAI as any).prototype.buildRequest = async function (o: any, ...r: any[]) { sent.push(`${o.method?.toUpperCase()} ${o.path}`); return orig.call(this, o, ...r); };

const client: any = (runtime as any).client;
for (const [name, obj] of [['POST /v1/responses', client.responses], ['POST /v1/chat/completions', client.chat.completions]] as const) {
  const create = obj.create.bind(obj);
  obj.create = (...a: any[]) => { sent.push(name); return create(...a); };
}
const models = await runtime.models();
const chat = models.filter((m: any) => m.type === 'chat' || !m.type);
const sonnet: any = models.find((m: any) => m.id === 'anthropic/claude-sonnet-5.5');
console.log(`models(): ${models.length} chat models; sonnet ->`, JSON.stringify({
  contextWindowTokens: sonnet?.contextWindowTokens, functionCall: sonnet?.abilities?.functionCall ?? sonnet?.functionCall, vision: sonnet?.abilities?.vision ?? sonnet?.vision,
  pricing: sonnet?.pricing?.units?.map((u: any) => `${u.name}=${u.rate}`),
}));

const readAll = async (res: Response) => {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let out = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  return out;
};

const text = await readAll(await runtime.chat({
  messages: [{ content: 'Count from 1 to 5, separated by spaces.', role: 'user' }],
  model: 'anthropic/claude-sonnet-5.5', stream: true, temperature: 0,
} as any));
const textDeltas = [...text.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).filter((d) => d.startsWith('"')).map((d) => JSON.parse(d)).join('');
console.log('chat stream text:', JSON.stringify(textDeltas.trim()));

const tool = await readAll(await runtime.chat({
  messages: [{ content: 'What is the weather in Paris? Use the tool.', role: 'user' }],
  model: 'anthropic/claude-sonnet-5.5', stream: true,
  tools: [{ function: { description: 'Get the weather for a city', name: 'get_weather',
    parameters: { properties: { city: { type: 'string' } }, required: ['city'], type: 'object' } }, type: 'function' }],
} as any));
const toolEvents = [...tool.matchAll(/^event: (.*)$/gm)].map((m) => m[1]);
const toolCall = tool.match(/"name":"get_weather"[^}]*\}[^}]*\}/);
console.log('tool stream events:', [...new Set(toolEvents)].join(','), '| tool call:', toolCall?.[0]);
console.log('upstream requests:', [...new Set(sent)].join(' ; '));
