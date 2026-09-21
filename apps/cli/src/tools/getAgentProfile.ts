import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RemoteHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type { RemotePlatformCommandRuntime } from '@lobechat/heterogeneous-agents/scanHost';
import { resolveRemotePlatformRuntime } from '@lobechat/heterogeneous-agents/scanHost';

export interface GetAgentProfileParams {
  /** Agent ID to query (openclaw only). Defaults to the default agent. */
  agentId?: string;
  platform: RemoteHeterogeneousAgentType;
}

export interface AgentProfileResult {
  avatar?: string;
  description?: string;
  title?: string;
}

// Files to look for a description (tried in order)
const IDENTITY_FILES = ['IDENTITY.md', 'SOUL.md'];

/**
 * Try to extract a description from the workspace identity file.
 * Looks for Creature / Vibe / Description fields in IDENTITY.md or SOUL.md.
 */
function readDescriptionFromWorkspace(workspacePath: string): string | undefined {
  for (const filename of IDENTITY_FILES) {
    const filePath = path.join(workspacePath, filename);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/\*{0,2}(?:Creature|Vibe|Description):?\*{0,2}\s*(.+)/i);
    if (!match) continue;

    const value = match[1].trim();
    // Skip unfilled template placeholders like _(pick something)_ or (TBD)
    if (/^[_*(（].*[）)*_]$|^(?:tbd|todo|n\/?a|none|待定|未定)$/i.test(value)) continue;
    return value;
  }
}

interface OpenClawAgentEntry {
  id: string;
  identityEmoji?: string;
  identityName?: string;
  isDefault?: boolean;
  workspace?: string;
}

type AvailableRemotePlatformRuntime = Extract<RemotePlatformCommandRuntime, { available: true }>;

async function runPlatformCommand(
  runtime: AvailableRemotePlatformRuntime,
  args: string[],
): Promise<string> {
  const { stdout } = await runtime.execute(args, { timeout: 5000 });
  return stdout;
}

async function getOpenClawProfile(
  runtime: AvailableRemotePlatformRuntime,
  agentId?: string,
): Promise<AgentProfileResult> {
  let output: string;
  try {
    output = await runPlatformCommand(runtime, ['agents', 'list', '--json']);
  } catch {
    return {};
  }

  let agents: OpenClawAgentEntry[];
  try {
    agents = JSON.parse(output) as OpenClawAgentEntry[];
  } catch {
    return {};
  }

  const agent = agentId
    ? agents.find((a) => a.id === agentId)
    : (agents.find((a) => a.isDefault) ?? agents[0]);

  if (!agent) return {};

  const title = agent.identityName || undefined;
  const avatar = agent.identityEmoji || '🦞'; // OpenClaw brand mascot as default

  // Description is not exposed by the CLI — read from the workspace IDENTITY.md
  const description = agent.workspace ? readDescriptionFromWorkspace(agent.workspace) : undefined;

  return { avatar, description, title };
}

/**
 * Read the active Hermes profile name from `hermes profile list` output.
 * The active profile is marked with ◆ in the first column.
 */
async function getActiveHermesProfileName(
  runtime: AvailableRemotePlatformRuntime,
): Promise<string | undefined> {
  try {
    const output = await runPlatformCommand(runtime, ['profile', 'list']);
    const match = output.match(/◆(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Read the filesystem path of a Hermes profile from `hermes profile show <name>`.
 */
async function getHermesProfilePath(
  runtime: AvailableRemotePlatformRuntime,
  profileName: string,
): Promise<string | undefined> {
  try {
    const output = await runPlatformCommand(runtime, ['profile', 'show', profileName]);
    const match = output.match(/^Path:\s+(.+)/m);
    const raw = match?.[1]?.trim();
    // Expand leading `~` — Node does not auto-expand home-dir shorthands.
    return raw?.replace(/^~(?=\/|$)/, os.homedir());
  } catch {
    return undefined;
  }
}

/**
 * Extract a one-line description from a Hermes SOUL.md file.
 * Strips HTML comments and Markdown headings, then returns the first
 * non-empty line of actual content.
 */
function readHermesSoulDescription(soulPath: string): string | undefined {
  try {
    const content = fs.readFileSync(soulPath, 'utf8');
    // Loop until stable to handle any malformed/nested comment sequences.
    let stripped = content;
    let previous: string;
    do {
      previous = stripped;
      stripped = stripped
        .replaceAll(/<!--[\s\S]*?-->/g, '') // strip complete HTML comments
        .replaceAll(/[<>]/g, '') // strip any remaining HTML delimiter chars
        .replaceAll(/^#+\s.*$/gm, ''); // strip Markdown headings
    } while (stripped !== previous);
    const line = stripped
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return line || undefined;
  } catch {
    return undefined;
  }
}

async function getHermesProfile(
  runtime: AvailableRemotePlatformRuntime,
): Promise<AgentProfileResult> {
  const profileName = await getActiveHermesProfileName(runtime);
  if (!profileName) return {};

  const profilePath = await getHermesProfilePath(runtime, profileName);
  const description = profilePath
    ? readHermesSoulDescription(path.join(profilePath, 'SOUL.md'))
    : undefined;

  return {
    avatar: '⚡',
    description,
    title: profileName,
  };
}

/**
 * Fetch the agent profile (title, avatar, description) from the platform
 * installed on this device. Dispatched by the server via `device.getAgentProfile`.
 *
 * - openclaw: `openclaw agents list --json` for name + emoji, workspace
 *             IDENTITY.md for description fallback
 * - hermes:   active profile name + SOUL.md description
 */
export async function getAgentProfile(params: GetAgentProfileParams): Promise<AgentProfileResult> {
  const { platform, agentId } = params;
  const runtime = await resolveRemotePlatformRuntime(platform);
  if (!runtime.available) return {};

  if (platform === 'openclaw') {
    return getOpenClawProfile(runtime, agentId);
  }

  if (platform === 'hermes') {
    return getHermesProfile(runtime);
  }

  return {};
}
