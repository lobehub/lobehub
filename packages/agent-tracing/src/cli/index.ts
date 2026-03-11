#!/usr/bin/env bun

import { Command } from 'commander';

import { registerInspectCommand } from './inspect';
import { registerListCommand } from './list';
import { registerPartialCommand } from './partial';

const program = new Command();

program.name('agent-tracing').description('Local agent execution snapshot viewer').version('1.0.0');

registerInspectCommand(program);
registerListCommand(program);
registerPartialCommand(program);

program.parse();
