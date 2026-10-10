import { Command } from 'commander';

export const taskCommand = new Command('task')
  .command('create')
  // alint-expect
  .description('Create a task with its project identifier prefix, or T when no project is assigned')
  .option('--project <id>', 'Project ID; tasks use the project identifier prefix, otherwise T')
  .requiredOption('--instruction <text>', 'Task instruction');
