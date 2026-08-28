/**
 * CLI argument syntax primitives shared by the heterogeneous-agent selector.
 *
 * Every helper here is provider-agnostic: it knows how `--flag value`,
 * `--flag=value` and `-c key="value"` are spelled, never which provider spells
 * them. Provider knowledge lives in `heteroSelectorCapabilities`.
 */

const CLI_CONFIG_FLAGS = ['-c', '--config'] as const;

export const hasCliFlag = (args: string[], flag: string): boolean =>
  args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));

export const hasAnyCliFlag = (args: string[], flags: readonly string[]): boolean =>
  flags.some((flag) => hasCliFlag(args, flag));

export const getCliFlagValue = (args: string[] | undefined, flag: string): string | undefined => {
  if (!args) return undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      const next = args[index + 1]?.trim();
      if (next && !next.startsWith('-')) return next;
    }

    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      if (value) return value;
    }
  }

  return undefined;
};

export const getAnyCliFlagValue = (
  args: string[] | undefined,
  flags: readonly string[],
): string | undefined => {
  for (const flag of flags) {
    const value = getCliFlagValue(args, flag);
    if (value) return value;
  }
};

const unquoteCliConfigValue = (value: string): string => {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseCliConfigAssignment = (assignment: string, key: string): string | undefined => {
  const match = assignment.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.+?)\\s*$`));
  if (!match?.[1]) return undefined;

  const value = unquoteCliConfigValue(match[1]);
  return value || undefined;
};

const matchesCliConfigKey = (assignment: string, key: string): boolean =>
  new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(assignment);

const findConfigFlagPrefix = (arg: string): (typeof CLI_CONFIG_FLAGS)[number] | undefined =>
  CLI_CONFIG_FLAGS.find((flag) => arg.startsWith(`${flag}=`));

const isConfigFlag = (arg: string): boolean =>
  CLI_CONFIG_FLAGS.includes(arg as (typeof CLI_CONFIG_FLAGS)[number]);

export const getCliConfigValue = (args: string[] | undefined, key: string): string | undefined => {
  if (!args) return undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (isConfigFlag(arg)) {
      const next = args[index + 1];
      if (next) {
        const value = parseCliConfigAssignment(next, key);
        if (value) return value;
        index += 1;
      }
      continue;
    }

    const configFlag = findConfigFlagPrefix(arg);
    if (configFlag) {
      const value = parseCliConfigAssignment(arg.slice(configFlag.length + 1), key);
      if (value) return value;
    }
  }
};

export const hasCliConfigKey = (args: string[], key: string): boolean =>
  !!getCliConfigValue(args, key);

export const stripCliFlags = (
  args: string[] | undefined,
  flags: readonly string[],
): string[] | undefined => {
  if (!args) return undefined;

  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (flags.includes(arg)) {
      const value = args[index + 1];
      if (value && !value.startsWith('-')) index += 1;
      continue;
    }

    if (flags.some((flag) => arg.startsWith(`${flag}=`))) continue;

    next.push(arg);
  }

  return next;
};

export const stripCliConfigKey = (
  args: string[] | undefined,
  key: string,
): string[] | undefined => {
  if (!args) return undefined;

  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (isConfigFlag(arg)) {
      const value = args[index + 1];
      if (value && matchesCliConfigKey(value, key)) {
        index += 1;
        continue;
      }

      next.push(arg);
      continue;
    }

    const configFlag = findConfigFlagPrefix(arg);
    if (configFlag && matchesCliConfigKey(arg.slice(configFlag.length + 1), key)) continue;

    next.push(arg);
  }

  return next;
};
