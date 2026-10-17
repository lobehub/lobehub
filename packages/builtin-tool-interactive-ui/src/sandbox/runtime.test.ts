// @vitest-environment jsdom

import { createContext, runInContext, runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { buildSandboxDocument } from './document';
import { WORKER_BOOTSTRAP } from './runtime';

describe('trusted bootstrap evaluation boundary (not browser CSP evidence)', () => {
  it('runs bootstrap before separately parsing generated declarations', () => {
    const blobs = new Map<string, string>();
    const generatedContexts: ReturnType<typeof createContext>[] = [];

    class FakeBlob {
      source: string;
      constructor(parts: string[]) {
        this.source = parts.join('');
      }
    }

    class FakeWorker {
      constructor(url: string) {
        const context = createContext({
          Worker: function OriginalWorker() {},
          addEventListener: () => {},
          postMessage: () => {},
          performance: { now: () => 0 },
          setInterval: () => 1,
        });
        context.self = context;
        context.importScripts = (sourceUrl: string) => runInContext(blobs.get(sourceUrl)!, context);
        generatedContexts.push(context);
        runInContext(blobs.get(url)!, context);
      }
      addEventListener() {}
      terminate() {}
    }

    const output = buildSandboxDocument(
      {
        html: '<p>Test</p>',
        // In the previous concatenated source this hoists over the trusted new
        // Map(), capturing Worker before its global property is locked down.
        js: 'function Map() { self.capturedWorker = Worker; this.size = 0; this.has = () => false; }',
      },
      'test-frame-nonce-123456789',
      'complete',
    );
    const script = new DOMParser()
      .parseFromString(output, 'text/html')
      .querySelector('script')!.textContent!;
    runInNewContext(script, {
      Blob: FakeBlob,
      URL: {
        createObjectURL: (blob: FakeBlob) => {
          const url = `blob:test-${blobs.size}`;
          blobs.set(url, blob.source);
          return url;
        },
        revokeObjectURL: () => {},
      },
      Worker: FakeWorker,
      clearInterval: () => {},
      clearTimeout: () => {},
      document: { getElementById: () => ({ querySelectorAll: () => [] }) },
      parent: { postMessage: () => {} },
      performance: { now: () => 0 },
      setInterval: () => 1,
      setTimeout: () => 1,
      window: { addEventListener: () => {} },
    });

    expect(generatedContexts).toHaveLength(1);
    expect(generatedContexts[0].capturedWorker).toBeUndefined();
    expect(generatedContexts[0].Worker).toBeUndefined();
    expect(blobs.size).toBe(2);
  });

  it('bounds scalars before structured cloning and removes inherited raw send', () => {
    const sent: unknown[] = [];
    const workerPrototype = {
      Worker: function OriginalWorker() {},
      postMessage: (value: unknown) => sent.push(value),
    };
    const context = createContext(
      Object.assign(Object.create(workerPrototype), {
        addEventListener: () => {},
        performance: { now: () => 0 },
        setInterval: () => 1,
      }),
    );
    context.self = context;
    runInContext(WORKER_BOOTSTRAP, context);
    runInContext(
      `
      lobeUI.setText('#result', 'x'.repeat(10001));
      lobeUI.setValue('#result', 'x'.repeat(10001));
      lobeUI.setStyle('#result', 'width', 'x'.repeat(501));
      lobeUI.setText('x'.repeat(201), 'text');
      lobeUI.propose('x'.repeat(2001));
      lobeUI.setText('#result', { toString() { throw new Error('must not coerce objects'); } });
    `,
      context,
    );
    expect(sent).toEqual([]);
    expect(runInContext('typeof self.postMessage', context)).toBe('undefined');
    expect(runInContext('typeof Object.getPrototypeOf(self).postMessage', context)).toBe(
      'undefined',
    );
    expect(runInContext('typeof Object.getPrototypeOf(self).Worker', context)).toBe('undefined');
    runInContext(`for (let i = 0; i < 1000; i++) lobeUI.setText('#result', i)`, context);
    expect(sent).toHaveLength(201);
    expect(sent[0]).toEqual({ selector: '#result', type: 'text', value: '0' });
    expect(sent.at(-1)).toEqual({ type: 'budget' });
  });
});
