import type { AgentProfileTab } from '@/features/AgentProfileTabs/tabOptions';

/**
 * The pages of a project's "Main agent" settings section. `basic` holds the
 * identity, prompt, model and opening cards written through the project; the
 * rest embed the agent's own editors for the coordinator the project resolves.
 */
export const COORDINATOR_SETTINGS_VIEWS = [
  'basic',
  'channel',
  'tools',
  'skills',
  'knowledge',
  'environment',
] as const;

export type CoordinatorSettingsView = (typeof COORDINATOR_SETTINGS_VIEWS)[number];

export const isCoordinatorSettingsView = (value: unknown): value is CoordinatorSettingsView =>
  typeof value === 'string' && (COORDINATOR_SETTINGS_VIEWS as readonly string[]).includes(value);

/**
 * The `/agent/:aid/<tab>` settings pages a project-owned agent no longer
 * serves, and the page of the project settings that replaces each. Tabs not
 * listed (statistics, share, mail, …) carry no configuration this section owns
 * and stay on the agent.
 */
const AGENT_TAB_TO_VIEW: Partial<Record<AgentProfileTab | 'settings', CoordinatorSettingsView>> = {
  channel: 'channel',
  engine: 'basic',
  environment: 'environment',
  instruction: 'basic',
  knowledge: 'knowledge',
  profile: 'basic',
  // Mobile's single agent settings page.
  settings: 'basic',
  skills: 'skills',
  tools: 'tools',
};

/**
 * Where an agent settings URL lands in the project settings, or `undefined`
 * when the URL is not one of the settings pages the project took over (the
 * conversation, topics and tasks keep their agent URLs).
 *
 * Accepts the pathname with or without a workspace prefix
 * (`/acme/agent/:aid/channel/telegram`).
 */
export const resolveCoordinatorRedirect = (
  pathname: string,
): { platform?: string; view: CoordinatorSettingsView } | undefined => {
  const match = /(?:^|\/)agent\/[^/]+\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return;
  const [, tab, sub] = match;
  const view = AGENT_TAB_TO_VIEW[tab as AgentProfileTab | 'settings'];
  if (!view) return;
  return view === 'channel' && sub ? { platform: sub, view } : { view };
};
