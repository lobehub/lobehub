#!/usr/bin/env bun

import { runCli } from './cli';

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
