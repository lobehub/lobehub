#!/usr/bin/env bun

import { Command } from 'commander';

import { registerCtxLintCommand } from './ctx-lint';
import { registerInspectCommand } from './inspect';
import { registerListCommand } from './list';
import { registerPartialCommand } from './partial';
import { registerToolQualityCommand } from './tool-quality';

const program = new Command();

program.name('agent-tracing').description('Local agent execution snapshot viewer').version('1.0.0');

registerInspectCommand(program);
registerListCommand(program);
registerPartialCommand(program);
registerToolQualityCommand(program);
registerCtxLintCommand(program);

program.parse();
