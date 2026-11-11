import { expect, it } from 'vitest';

declare const readRun: () => Promise<{ metadata: { summary: string } } | undefined>;
declare const completionHook: () => { handler: () => void } | undefined;

it('reads the persisted summary', async () => {
  const run = await readRun();

  expect(run).toBeDefined();
  expect(run!.metadata).toMatchObject({ summary: 'done' });
});

it('registers a callable completion hook', () => {
  const hook = completionHook();

  expect(hook).toBeDefined();
  expect(hook!.handler).toBeInstanceOf(Function);
});
