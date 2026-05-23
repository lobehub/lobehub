#!/usr/bin/env bun

import { Command } from 'commander';

import { registerInspectCommand } from './inspect';
import { registerListCommand } from './list';

const program = new Command();

program
  .name('llm-tracing')
  .description('Inspect local llm-generation-tracing records under .llm-generation-tracing/')
  .version('1.0.0');

registerInspectCommand(program);
registerListCommand(program);

program.parse();
