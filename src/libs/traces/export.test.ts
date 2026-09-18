// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import {
  LangfuseOtelSpanAttributes as A,
  propagateAttributes,
  startObservation,
} from '@langfuse/tracing';
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { flushTraces, getLangfuseClient, getLangfuseSpanProcessor } from './index';

const requests: { body: any; headers: Record<string, unknown>; url?: string }[] = [];
let server: Server;
let provider: BasicTracerProvider;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ body, headers: req.headers, url: req.url });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api/public/ingestion'
          ? {
              errors: [],
              successes: body.batch.map(({ id }: { id: string }) => ({ id, status: 201 })),
            }
          : {},
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv('ENABLE_LANGFUSE', '1');
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-test');
  vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-test');
  vi.stubEnv('LANGFUSE_HOST', `http://127.0.0.1:${port}`);
  vi.stubEnv('LANGFUSE_MEDIA_UPLOAD_ENABLED', 'false');
  provider = new BasicTracerProvider({ spanProcessors: [getLangfuseSpanProcessor()!] });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});

afterAll(async () => {
  await getLangfuseClient()?.shutdown();
  await provider?.shutdown();
  context.disable();
  trace.disable();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('real Langfuse SDK export', () => {
  it('sends v4 OTLP observations and scores to the configured host, without unrelated spans', async () => {
    const root = context.with(ROOT_CONTEXT, () =>
      propagateAttributes({ userId: 'user-1', sessionId: 'session-1' }, () => {
        const observation = startObservation('chat', { input: 'hello', output: 'world' });
        const generation = observation.startObservation(
          'model',
          { model: 'test-model', output: 'world' },
          { asType: 'generation' },
        );
        getLangfuseClient()!.score.create({
          name: 'copy message',
          value: 0.6,
          traceId: generation.traceId,
          observationId: generation.id,
        });
        generation.end();
        observation.end();
        return observation;
      }),
    );
    trace
      .getTracer('unrelated')
      .startSpan('private operational span', { attributes: { 'gen_ai.operation.name': 'chat' } })
      .end();
    await flushTraces();

    const otlp = requests.filter(({ url }) => url === '/api/public/otel/v1/traces');
    expect(otlp.length).toBeGreaterThan(0);
    expect(otlp[0].headers.authorization).toBe(
      `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
    );
    expect(otlp[0].headers['x-langfuse-sdk-version']).toMatch(/^5\./);
    const spans = otlp.flatMap(({ body }) =>
      body.resourceSpans.flatMap((resource: any) =>
        resource.scopeSpans.flatMap((scope: any) => scope.spans),
      ),
    );
    expect(spans.map((span: any) => span.name).sort()).toEqual(['chat', 'model']);
    expect(spans.every((span: any) => span.traceId === root.traceId)).toBe(true);
    for (const span of spans) {
      const attributes = Object.fromEntries(
        span.attributes.map(({ key, value }: any) => [key, value.stringValue]),
      );
      expect(attributes).toMatchObject({
        'user.id': 'user-1',
        'session.id': 'session-1',
        [A.OBSERVATION_OUTPUT]: 'world',
      });
    }
    const scores = requests
      .filter(({ url }) => url === '/api/public/ingestion')
      .flatMap(({ body }) => body.batch);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({
      type: 'score-create',
      body: { name: 'copy message', value: 0.6, traceId: root.traceId },
    });

    // A later request must still export after the first request flushed.
    startObservation('next request').end();
    await flushTraces();
    expect(JSON.stringify(requests)).toContain('next request');
  });
});
