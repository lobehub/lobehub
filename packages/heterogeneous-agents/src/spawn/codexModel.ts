import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { UsageData } from '../types';
import { toCodexUsageData } from '../utils/codexUsage';

type CodexEnv = Record<string, string | undefined>;

export type CodexInitialModelSource = 'args' | 'config';

export interface CodexInitialModelResolution {
  model: string;
  profile?: string;
  source: CodexInitialModelSource;
}

export interface CodexSessionModelInfo {
  contextWindow?: number;
  cumulativeUsage?: UsageData | undefined;
  line?: number;
  model?: string;
  provider?: string;
  sourceFile?: string;
}

interface CodexModelResolveOptions {
  args: string[];
  env?: CodexEnv;
  homeDir?: string;
}

interface CodexSessionModelReadOptions {
  env?: CodexEnv;
  homeDir?: string;
}

const CODEX_CONFIG_OVERRIDES = ['-c', '--config'] as const;
const CODEX_MODEL_FLAGS = ['-m', '--model'] as const;
const CODEX_PROFILE_FLAGS = ['-p', '--profile'] as const;

const unquoteTomlString = (value: string): string => {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const parseTomlStringAssignment = (line: string, key: string): string | undefined => {
  const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`));
  if (!match?.[1]) return;

  const value = unquoteTomlString(match[1]);
  return value || undefined;
};

const normalizeProfileName = (raw: string): string => unquoteTomlString(raw.trim());

const parseTomlTableName = (line: string): string | undefined => {
  const match = line.trim().match(/^\[([^\]]+)\]/);
  return match?.[1]?.trim();
};

const getProfileNameFromTable = (table: string): string | undefined => {
  if (!table.startsWith('profiles.')) return;

  const raw = table.slice('profiles.'.length).trim();
  return raw ? normalizeProfileName(raw) : undefined;
};

export const getCodexHome = (
  env: CodexEnv = process.env,
  homeDir: string = os.homedir(),
): string => {
  const configured = env.CODEX_HOME?.trim();
  return configured || path.join(homeDir, '.codex');
};

export const parseCodexModelFromArgs = (args: string[]): string | undefined => {
  let model: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (CODEX_MODEL_FLAGS.includes(arg as (typeof CODEX_MODEL_FLAGS)[number])) {
      const next = args[index + 1];
      if (next && !next.startsWith('-')) {
        model = next;
        index += 1;
      }
      continue;
    }

    const modelFlag = CODEX_MODEL_FLAGS.find((flag) => arg.startsWith(`${flag}=`));
    if (modelFlag) {
      const value = arg.slice(modelFlag.length + 1).trim();
      if (value) model = value;
      continue;
    }

    if (CODEX_CONFIG_OVERRIDES.includes(arg as (typeof CODEX_CONFIG_OVERRIDES)[number])) {
      const next = args[index + 1];
      if (next) {
        const value = parseTomlStringAssignment(next, 'model');
        if (value) model = value;
        index += 1;
      }
      continue;
    }

    const configFlag = CODEX_CONFIG_OVERRIDES.find((flag) => arg.startsWith(`${flag}=`));
    if (configFlag) {
      const value = parseTomlStringAssignment(arg.slice(configFlag.length + 1), 'model');
      if (value) model = value;
    }
  }

  return model;
};

export const parseCodexProfileFromArgs = (args: string[]): string | undefined => {
  let profile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (CODEX_PROFILE_FLAGS.includes(arg as (typeof CODEX_PROFILE_FLAGS)[number])) {
      const next = args[index + 1];
      if (next && !next.startsWith('-')) {
        profile = next;
        index += 1;
      }
      continue;
    }

    const profileFlag = CODEX_PROFILE_FLAGS.find((flag) => arg.startsWith(`${flag}=`));
    if (profileFlag) {
      const value = arg.slice(profileFlag.length + 1).trim();
      if (value) profile = value;
    }
  }

  return profile;
};

const parseCodexConfigModels = (
  content: string,
): { defaultModel?: string; profileModels: Map<string, string> } => {
  let currentProfile: string | undefined;
  let inNonProfileTable = false;
  const profileModels = new Map<string, string>();
  let defaultModel: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const table = parseTomlTableName(line);
    if (table) {
      currentProfile = getProfileNameFromTable(table);
      inNonProfileTable = !currentProfile;
      continue;
    }

    const model = parseTomlStringAssignment(line, 'model');
    if (!model) continue;

    if (currentProfile) {
      profileModels.set(currentProfile, model);
    } else if (!inNonProfileTable) {
      defaultModel = model;
    }
  }

  return { defaultModel, profileModels };
};

export const resolveCodexInitialModel = async ({
  args,
  env = process.env,
  homeDir,
}: CodexModelResolveOptions): Promise<CodexInitialModelResolution | undefined> => {
  const modelFromArgs = parseCodexModelFromArgs(args);
  const profile = parseCodexProfileFromArgs(args);
  if (modelFromArgs) return { model: modelFromArgs, profile, source: 'args' };

  try {
    const config = await readFile(path.join(getCodexHome(env, homeDir), 'config.toml'), 'utf8');
    const { defaultModel, profileModels } = parseCodexConfigModels(config);
    const profileModel = profile ? profileModels.get(profile) : undefined;
    const model = profileModel || defaultModel;

    return model ? { model, profile, source: 'config' } : undefined;
  } catch {
    return;
  }
};

const findCodexSessionFiles = async (root: string, threadId: string): Promise<string[]> => {
  const out: string[] = [];

  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          return;
        }

        if (entry.isFile() && entry.name.includes(threadId) && entry.name.endsWith('.jsonl')) {
          out.push(fullPath);
        }
      }),
    );
  };

  await visit(root);
  return out;
};

const readNewestMatchingSessionFile = async (
  codexHome: string,
  threadId: string,
): Promise<string | undefined> => {
  const roots = [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')];
  const files = (await Promise.all(roots.map((root) => findCodexSessionFiles(root, threadId))))
    .flat()
    .filter(Boolean);

  if (files.length === 0) return;

  const stats = await Promise.all(
    files.map(async (file) => ({
      file,
      mtimeMs: await stat(file)
        .then((item) => item.mtimeMs)
        .catch(() => 0),
    })),
  );

  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0]?.file;
};

const getNumberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getStringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export const readCodexSessionModel = async (
  threadId: string | undefined,
  { env = process.env, homeDir }: CodexSessionModelReadOptions = {},
): Promise<CodexSessionModelInfo | undefined> => {
  if (!threadId) return;

  const sourceFile = await readNewestMatchingSessionFile(getCodexHome(env, homeDir), threadId);
  if (!sourceFile) return;

  let model: string | undefined;
  let provider: string | undefined;
  let contextWindow: number | undefined;
  let cumulativeUsage: UsageData | undefined;
  let lineNumber: number | undefined;

  const content = await readFile(sourceFile, 'utf8').catch(() => undefined);
  if (!content) return;

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    try {
      const record = JSON.parse(line);
      const payload = record?.payload;
      const usage =
        toCodexUsageData(payload?.info?.total_token_usage) ||
        toCodexUsageData(record?.usage) ||
        toCodexUsageData(payload?.usage);
      if (usage) cumulativeUsage = usage;

      const payloadModel =
        getStringValue(payload?.model) ||
        getStringValue(payload?.collaboration_mode?.settings?.model);
      if (payloadModel) {
        model = payloadModel;
        lineNumber = index + 1;
      }

      provider = getStringValue(payload?.model_provider) || provider;
      contextWindow = getNumberValue(payload?.model_context_window) || contextWindow;
    } catch {
      continue;
    }
  }

  return model || provider || contextWindow || cumulativeUsage
    ? { contextWindow, cumulativeUsage, line: lineNumber, model, provider, sourceFile }
    : undefined;
};
