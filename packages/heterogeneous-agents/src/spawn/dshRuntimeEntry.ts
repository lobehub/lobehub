#!/usr/bin/env node

import { runDshRuntime } from './dshRuntime';

const main = async (): Promise<void> => {
  const runtime = await runDshRuntime();

  process.stdin.on('end', () => void runtime.dispose(0));
  process.on('SIGTERM', () => void runtime.dispose(0));
  process.on('SIGINT', () => void runtime.dispose(130));
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
