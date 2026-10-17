import { getConnectorCatalog } from '@lobechat/const';
import { type AgentPluginEntry, parsePluginEntry } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { agentSkillService, type EnsureMarketSkillResult } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { agentSkillListResource } from '@/store/tool/slices/agentSkills/projection';
import { connectorSelectors } from '@/store/tool/slices/connector';

/** The server accepts at most this many identifiers per `ensureFromMarket` call. */
export const MARKET_SKILL_ENSURE_BATCH_SIZE = 50;

type EnsureFailure = Extract<EnsureMarketSkillResult, { status: 'failed' }>;

export type AgentPluginsInput = AgentPluginEntry[] | AgentPluginEntry[][] | null | undefined;

const unavailable = (identifier: string, error?: unknown): EnsureFailure => ({
  identifier,
  ...(error instanceof Error && error.message ? { message: error.message } : {}),
  reason: 'unavailable',
  status: 'failed',
});

/** Identifiers of every agent's plugin entries (any mode), first-seen order, deduped. */
const collectIdentifiers = (input: AgentPluginsInput): string[] => {
  const identifiers = new Set<string>();
  const visit = (entry: AgentPluginEntry | AgentPluginsInput) => {
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (!entry) return;
    const { identifier } = parsePluginEntry(entry);
    const trimmed = identifier?.trim();
    if (trimmed) identifiers.add(trimmed);
  };
  visit(input);
  return [...identifiers];
};

/**
 * Identifiers the local catalog already resolves to something that is not a
 * Market skill to install: builtin tools and skills, installed plugins,
 * connectors and, once the skills list is server-confirmed, installed Market
 * skills (a list hydrated from the persisted copy can miss what was installed
 * elsewhere, and the server answers `installed` for those anyway). A same-named skill from another
 * source is deliberately not listed — the server reports it as a conflict.
 */
const getResolvedIdentifiers = (): Set<string> => {
  const state = useToolStore.getState();
  const resolved = new Set<string>();

  for (const tool of builtinToolSelectors.installedAllMetaList(state))
    resolved.add(tool.identifier);
  for (const skill of builtinToolSelectors.installedBuiltinSkills(state)) {
    resolved.add(skill.identifier);
  }
  for (const plugin of pluginSelectors.installedPluginMetaList(state)) {
    resolved.add(plugin.identifier);
  }
  for (const connector of connectorSelectors.customConnectors(state)) {
    resolved.add(connector.identifier);
  }
  // Catalog membership does not depend on which providers this deployment enables.
  for (const item of getConnectorCatalog({ composio: true, lobehub: true })) {
    resolved.add(item.type === 'lobehub' ? item.provider.id : item.serverType.identifier);
  }
  if (agentSkillsSelectors.isAgentSkillListSynced(state)) {
    for (const skill of agentSkillsSelectors.getMarketAgentSkills(state)) {
      resolved.add(skill.identifier);
    }
  }

  return resolved;
};

const ensureBatch = async (identifiers: string[]): Promise<EnsureMarketSkillResult[]> => {
  try {
    const response = await agentSkillService.ensureFromMarket(identifiers);
    if (!Array.isArray(response)) return identifiers.map((id) => unavailable(id));

    const byIdentifier = new Map(response.map((result) => [result.identifier, result]));
    return identifiers.map((id) => byIdentifier.get(id) ?? unavailable(id));
  } catch (error) {
    return identifiers.map((id) => unavailable(id, error));
  }
};

/**
 * Install the Market skills referenced by agent `plugins` into the active
 * scope. Accepts one agent's plugins or several agents' (merged and deduped),
 * and reports one result per identifier it asked the server about.
 *
 * It never throws: any failure becomes a `failed`/`unavailable` result, and a
 * failed list refresh does not change the install results.
 */
export const ensureAgentMarketSkills = async (
  input: AgentPluginsInput,
): Promise<EnsureMarketSkillResult[]> => {
  let identifiers: string[];
  try {
    const resolved = getResolvedIdentifiers();
    identifiers = collectIdentifiers(input).filter((id) => !resolved.has(id));
  } catch (error) {
    // Without the local catalog we cannot tell what to send; report the whole set.
    return collectIdentifiers(input).map((id) => unavailable(id, error));
  }
  if (identifiers.length === 0) return [];

  // Every request is written into whichever scope is active when it is sent
  // (`lambdaClient` reads the workspace per call), so the whole run stays in the
  // scope it started under: once the identity switched, later batches are not
  // sent and the list refresh is skipped.
  const scope = agentSkillListResource.scope.get();
  const isCurrentScope = () => agentSkillListResource.scope.get() === scope;

  const results: EnsureMarketSkillResult[] = [];
  for (let i = 0; i < identifiers.length; i += MARKET_SKILL_ENSURE_BATCH_SIZE) {
    const batch = identifiers.slice(i, i + MARKET_SKILL_ENSURE_BATCH_SIZE);
    results.push(
      ...(isCurrentScope()
        ? await ensureBatch(batch)
        : batch.map((id) => unavailable(id, new Error('Workspace changed before install')))),
    );
  }

  if (isCurrentScope() && results.some((result) => result.status === 'installed')) {
    try {
      await useToolStore.getState().refreshAgentSkills();
    } catch (error) {
      console.warn('Failed to refresh agent skills after ensuring market skills:', error);
    }
  }

  return results;
};

/** One merged warning for the skills that could not be installed. `notSkill` is not a failure. */
export const warnMarketSkillFailures = (results: EnsureMarketSkillResult[]): void => {
  const failed = results.filter((result) => result.status === 'failed');
  if (failed.length === 0) return;

  toast.warning(
    t('agentSkills.ensureFailed', {
      ns: 'common',
      skills: failed.map((result) => result.identifier).join(', '),
    }),
  );
};

/**
 * Ensure, then warn about failures. The agent was already created by the
 * caller, so nothing here may fail the caller.
 */
export const ensureAgentMarketSkillsAndWarn = async (
  input: AgentPluginsInput,
): Promise<EnsureMarketSkillResult[]> => {
  try {
    const results = await ensureAgentMarketSkills(input);
    warnMarketSkillFailures(results);
    return results;
  } catch (error) {
    console.warn('Failed to ensure market skills:', error);
    return [];
  }
};
