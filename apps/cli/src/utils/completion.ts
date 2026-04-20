import type { Command, Option } from 'commander';
import { InvalidArgumentError } from 'commander';

const CLI_BIN_NAMES = ['lh', 'lobe', 'lobehub'] as const;
const SUPPORTED_SHELLS = ['bash', 'zsh'] as const;

type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

interface HiddenCommand extends Command {
  _hidden?: boolean;
}

interface HiddenOption extends Option {
  hidden: boolean;
}

function isVisibleCommand(command: Command) {
  return !(command as HiddenCommand)._hidden;
}

function isVisibleOption(option: Option) {
  return !(option as HiddenOption).hidden;
}

function listCommandTokens(command: Command) {
  return [command.name(), ...command.aliases()].filter(Boolean);
}

function listOptionTokens(command: Command) {
  return command.options
    .filter(isVisibleOption)
    .flatMap((option) => [option.short, option.long].filter(Boolean) as string[]);
}

function findSubcommand(command: Command, token: string) {
  return command.commands.find(
    (subcommand) => isVisibleCommand(subcommand) && listCommandTokens(subcommand).includes(token),
  );
}

function findOption(command: Command, token: string) {
  return command.options.find(
    (option) =>
      isVisibleOption(option) && (option.short === token || option.long === token || false),
  );
}

function filterCandidates(candidates: string[], currentWord: string) {
  const unique = [...new Set(candidates)];

  if (!currentWord) return unique.sort();

  return unique.filter((candidate) => candidate.startsWith(currentWord)).sort();
}

function resolveCommandContext(program: Command, completedWords: string[]) {
  let command = program;
  let expectsOptionValue = false;

  for (const token of completedWords) {
    if (expectsOptionValue) {
      expectsOptionValue = false;
      continue;
    }

    if (!token) continue;

    if (token.startsWith('-')) {
      const option = findOption(command, token);

      expectsOptionValue = Boolean(
        option && (option.required || option.optional || option.variadic),
      );
      continue;
    }

    const subcommand = findSubcommand(command, token);
    if (subcommand) {
      command = subcommand;
    }
  }

  return { command, expectsOptionValue };
}

export function getCompletionCandidates(
  program: Command,
  words: string[],
  currentWordIndex = words.length,
) {
  const safeCurrentWordIndex = Math.min(Math.max(currentWordIndex, 0), words.length);
  const completedWords = words.slice(0, safeCurrentWordIndex);
  const currentWord = safeCurrentWordIndex < words.length ? words[safeCurrentWordIndex] || '' : '';
  const { command, expectsOptionValue } = resolveCommandContext(program, completedWords);

  if (expectsOptionValue) return [];

  const commandCandidates = currentWord.startsWith('-')
    ? []
    : command.commands
        .filter(isVisibleCommand)
        .flatMap((subcommand) => listCommandTokens(subcommand));

  if (commandCandidates.length > 0) {
    return filterCandidates(commandCandidates, currentWord);
  }

  return filterCandidates(listOptionTokens(command), currentWord);
}

export function parseCompletionWordIndex(rawValue: string | undefined, words: string[]) {
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (Number.isNaN(parsedValue)) return words.length;

  return Math.min(Math.max(parsedValue, 0), words.length);
}

export function resolveCompletionShell(shell?: string): SupportedShell {
  const fallbackShell = process.env.SHELL?.split('/').pop() || 'zsh';
  const resolvedShell = (shell || fallbackShell).toLowerCase();

  if ((SUPPORTED_SHELLS as readonly string[]).includes(resolvedShell)) {
    return resolvedShell as SupportedShell;
  }

  throw new InvalidArgumentError(
    `Unsupported shell "${resolvedShell}". Supported shells: ${SUPPORTED_SHELLS.join(', ')}`,
  );
}

export function renderCompletionScript(shell: SupportedShell) {
  if (shell === 'bash') {
    return [
      '# shellcheck shell=bash',
      '_lobehub_completion() {',
      "  local IFS=$'\\n'",
      '  local current_index=$((COMP_CWORD - 1))',
      '  local completions',
      '  completions=$(LOBEHUB_COMP_CWORD="$current_index" "${COMP_WORDS[0]}" __complete "${COMP_WORDS[@]:1}")',
      '  COMPREPLY=($(printf \'%s\\n\' "$completions"))',
      '}',
      `complete -o nosort -F _lobehub_completion ${CLI_BIN_NAMES.join(' ')}`,
    ].join('\n');
  }

  return [
    `#compdef ${CLI_BIN_NAMES.join(' ')}`,
    '_lobehub_completion() {',
    '  local -a completions',
    '  local current_index=$((CURRENT - 2))',
    '  completions=("${(@f)$(LOBEHUB_COMP_CWORD="$current_index" "$words[1]" __complete "${(@)words[@]:1}")}")',
    "  _describe 'values' completions",
    '}',
    `compdef _lobehub_completion ${CLI_BIN_NAMES.join(' ')}`,
  ].join('\n');
}
