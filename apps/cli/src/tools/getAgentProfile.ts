import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { RemoteHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';

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

function getOpenClawProfile(agentId?: string): AgentProfileResult {
  let output: string;
  try {
    output = execFileSync('openclaw', ['agents', 'list', '--json'], {
      encoding: 'utf8',
      timeout: 5000,
    });
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
function getActiveHermesProfileName(): string | undefined {
  try {
    const output = execFileSync('hermes', ['profile', 'list'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const match = output.match(/◆(\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Read the filesystem path of a Hermes profile from `hermes profile show <name>`.
 */
function getHermesProfilePath(profileName: string): string | undefined {
  try {
    const output = execFileSync('hermes', ['profile', 'show', profileName], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const match = output.match(/^Path:\s+(.+)/m);
    return match?.[1]?.trim();
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
    const stripped = content
      .replaceAll(/<!--[\s\S]*?-->/g, '') // strip HTML comments
      .replaceAll(/^#+\s.*$/gm, ''); // strip Markdown headings
    const line = stripped
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return line || undefined;
  } catch {
    return undefined;
  }
}

function getHermesProfile(): AgentProfileResult {
  const profileName = getActiveHermesProfileName();
  if (!profileName) return {};

  const profilePath = getHermesProfilePath(profileName);
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

  if (platform === 'openclaw') {
    return getOpenClawProfile(agentId);
  }

  if (platform === 'hermes') {
    return getHermesProfile();
  }

  return {};
}
