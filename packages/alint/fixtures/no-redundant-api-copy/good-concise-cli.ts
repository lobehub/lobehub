import { Command } from 'commander';

export const taskCommand = new Command('task')
  .command('create')
  .description('Create a new task')
  .requiredOption('--instruction <text>', 'Task instruction');
