import type { Argument, Command } from 'commander';

const ROOT_ALIASES = ['lobe', 'lobehub'];
const HELP_COMMAND_NAME = 'help';

interface DefinitionItem {
  description: string;
  term: string;
}

interface ResolutionResult {
  command?: Command;
  error?: string;
}

export function registerManCommand(program: Command) {
  program
    .command('man [command...]')
    .description('Show a manual page for the CLI or a subcommand')
    .action((commandPath: string[] | undefined) => {
      const segments = commandPath ?? [];
      const resolution = resolveCommandPath(program, segments);

      if (!resolution.command) {
        program.error(resolution.error || 'Unknown command path.');
        return;
      }

      console.log(renderManualPage(program, resolution.command));
    });
}

function resolveCommandPath(root: Command, segments: string[]): ResolutionResult {
  let current = root;

  for (const segment of segments) {
    const next = getVisibleCommands(current).find(
      (command) => command.name() === segment || command.aliases().includes(segment),
    );

    if (!next) {
      const currentPath = buildCommandPath(current).join(' ');
      const available = getVisibleCommands(current)
        .map((command) => command.name())
        .join(', ');

      return {
        error: `Unknown command "${segment}" under "${currentPath}". Available: ${available || 'none'}.`,
      };
    }

    current = next;
  }

  return { command: current };
}

function renderManualPage(root: Command, command: Command) {
  const sections = [
    formatManualHeader(command),
    formatNameSection(command),
    formatSynopsisSection(root, command),
    formatAliasesSection(command),
    formatDescriptionSection(command),
    formatArgumentsSection(command),
    formatCommandsSection(command),
    formatOptionsSection(command),
    formatSeeAlsoSection(root, command),
  ].filter(Boolean);

  return sections.join('\n\n');
}

function formatManualHeader(command: Command) {
  return `${buildCommandPath(command).join('-').toUpperCase()}(1)`;
}

function formatNameSection(command: Command) {
  return ['NAME', `  ${buildCommandPath(command).join(' ')} - ${command.description()}`].join('\n');
}

function formatSynopsisSection(root: Command, command: Command) {
  return ['SYNOPSIS', `  ${buildSynopsis(root, command)}`].join('\n');
}

function formatAliasesSection(command: Command) {
  const aliases = command.parent ? command.aliases() : ROOT_ALIASES;

  if (aliases.length === 0) return '';

  return ['ALIASES', `  ${aliases.join(', ')}`].join('\n');
}

function formatDescriptionSection(command: Command) {
  const description = command.description() || 'No description available.';

  return ['DESCRIPTION', `  ${description}`].join('\n');
}

function formatArgumentsSection(command: Command) {
  if (command.registeredArguments.length === 0) return '';

  const items = command.registeredArguments.map((argument) => ({
    description: describeArgument(argument),
    term: formatArgumentTerm(argument),
  }));

  return ['ARGUMENTS', ...formatDefinitionList(items)].join('\n');
}

function formatCommandsSection(command: Command) {
  const help = command.createHelp();
  const items = getVisibleCommands(command).map((subcommand) => ({
    description: help.subcommandDescription(subcommand),
    term: buildSubcommandTerm(subcommand),
  }));

  if (items.length === 0) return '';

  return ['COMMANDS', ...formatDefinitionList(items)].join('\n');
}

function formatOptionsSection(command: Command) {
  const help = command.createHelp();
  const items = help.visibleOptions(command).map((option) => ({
    description: help.optionDescription(option),
    term: help.optionTerm(option),
  }));

  if (items.length === 0) return '';

  return ['OPTIONS', ...formatDefinitionList(items)].join('\n');
}

function formatSeeAlsoSection(root: Command, command: Command) {
  const items = new Set<string>();
  const currentPath = buildCommandPath(command);

  items.add(`${currentPath.join(' ')} --help`);

  const parent = command.parent;
  if (parent) {
    const parentPath = buildCommandPath(parent).slice(1).join(' ');
    items.add(parentPath ? `lh man ${parentPath}` : 'lh man');
  }

  for (const subcommand of getVisibleCommands(command).slice(0, 5)) {
    items.add(`lh man ${buildCommandPath(subcommand).slice(1).join(' ')}`);
  }

  return ['SEE ALSO', ...Array.from(items).map((item) => `  ${item}`)].join('\n');
}

function getVisibleCommands(command: Command) {
  const help = command.createHelp();

  return help
    .visibleCommands(command)
    .filter((subcommand) => subcommand.name() !== HELP_COMMAND_NAME);
}

function buildSynopsis(root: Command, command: Command) {
  const path = buildCommandPath(command);

  if (command === root) {
    return `${path[0]} ${command.usage()}`.trim();
  }

  return `${path.join(' ')} ${command.usage()}`.trim();
}

function buildCommandPath(command: Command): string[] {
  const path: string[] = [];
  let current: Command | null = command;

  while (current) {
    path.unshift(current.name());
    current = current.parent || null;
  }

  return path;
}

function buildSubcommandTerm(command: Command) {
  const name = [command.name(), ...command.aliases()].join('|');
  const usage = command.usage();

  return usage ? `${name} ${usage}` : name;
}

function formatDefinitionList(items: DefinitionItem[]) {
  const width = Math.max(...items.map((item) => item.term.length));

  return items.map((item) => `  ${item.term.padEnd(width)}  ${item.description}`);
}

function formatArgumentTerm(argument: Argument) {
  const name = argument.name();

  if (argument.required) {
    return argument.variadic ? `<${name}...>` : `<${name}>`;
  }

  return argument.variadic ? `[${name}...]` : `[${name}]`;
}

function describeArgument(argument: Argument) {
  const required = argument.required ? 'Required' : 'Optional';
  const variadic = argument.variadic ? 'variadic ' : '';

  return `${required} ${variadic}argument`;
}
