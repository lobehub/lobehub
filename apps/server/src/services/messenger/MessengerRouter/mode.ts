import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import type { LobeChatDatabase } from '@/database/type';
import { resolveToolMode } from '@/helpers/executionTarget';
import { isResourceAuthorOrAdmin } from '@/server/services/resourcePermission';

import type { getMessengerSystemStrings } from '../systemReply';
import type { AgentPickerEntry } from '../types';

const log = debug('lobe-server:messenger:router');

/**
 * Effective mode for a conversation with no explicit `/mode` override: the
 * active agent's chatConfig default, with the caller's workspace member-mode
 * override layered on top — the same preference path `execAgent` resolves at
 * execution time, so the picker mark matches what the next bot turn actually
 * runs. `custom` keeps tools enabled (a hand-picked set), so the binary
 * picker surfaces it on the Agent side. Best-effort: any lookup failure
 * falls back to `agent` (the product default) rather than blocking the
 * picker.
 */
export async function resolveDefaultMode(
  serverDB: LobeChatDatabase,
  link: SafeMessengerAccountLink,
): Promise<'agent' | 'chat'> {
  if (!link.activeAgentId) return 'agent';
  try {
    const agent = await new AgentModel(
      serverDB,
      link.userId,
      link.workspaceId ?? undefined,
    ).getAgentConfigById(link.activeAgentId);
    const chatConfig = (agent as any)?.chatConfig ?? undefined;
    const effectiveChatConfig =
      (await resolveMemberModeChatConfig(serverDB, link, agent)) ?? chatConfig;
    return resolveToolMode(effectiveChatConfig) === 'chat' ? 'chat' : 'agent';
  } catch (error) {
    log('resolveDefaultMode: falling back to agent default: %O', error);
    return 'agent';
  }
}

/**
 * Mirror `execAgent`'s workspace member-mode resolution: a non-manager's
 * `agentModeOverrides` entry patches `enableAgentMode` over the shared
 * chatConfig (an explicit `chatConfig.toolMode` still wins inside
 * `resolveToolMode`, exactly as at execution time). Returns undefined when
 * no override applies — including on lookup failure, where the shared
 * config is a better fallback than the product default.
 */
export async function resolveMemberModeChatConfig(
  serverDB: LobeChatDatabase,
  link: SafeMessengerAccountLink,
  agent: unknown,
): Promise<Record<string, unknown> | undefined> {
  if (!link.workspaceId || !link.activeAgentId) return undefined;
  try {
    const preference = await new WorkspaceUserSettingsModel(
      serverDB,
      link.userId,
      link.workspaceId,
    ).getPreference();
    const memberModeOverride = preference.agentModeOverrides?.[link.activeAgentId];
    if (memberModeOverride === undefined) return undefined;

    const agentRow = agent as
      | {
          chatConfig?: Record<string, unknown>;
          userId?: string;
          visibility?: string;
          workspaceId?: string;
        }
      | undefined;
    // Managers run the shared config and ignore their own stale overrides.
    // Fail-closed like execAgent: a permission-lookup error keeps applying
    // member policy rather than granting shared-config semantics.
    let canManage = agentRow?.userId === link.userId;
    const agentWorkspaceId = agentRow?.workspaceId ?? link.workspaceId;
    // Unknown author → skip the lookup and stay fail-closed (member policy
    // applies), matching the catch branch below.
    if (!canManage && agentRow?.userId && agentRow.visibility !== 'private') {
      try {
        canManage = await isResourceAuthorOrAdmin({
          db: serverDB,
          meta: {
            userId: agentRow.userId,
            visibility: agentRow.visibility ?? 'public',
            workspaceId: agentWorkspaceId,
          },
          resourceType: 'agent',
          userId: link.userId,
          workspaceId: agentWorkspaceId,
        });
      } catch (error) {
        log('resolveMemberModeChatConfig: permission lookup failed (fail-closed): %O', error);
      }
    }
    if (canManage) return undefined;
    return { ...agentRow?.chatConfig, enableAgentMode: memberModeOverride };
  } catch (error) {
    log('resolveMemberModeChatConfig: falling back to shared config: %O', error);
    return undefined;
  }
}

/** Entries for the `/mode` tap picker — the active mark shows the effective
 *  mode (explicit override, or the agent's configured default). */
export function modePickerEntries(
  current: 'agent' | 'chat' | undefined,
  strings: ReturnType<typeof getMessengerSystemStrings>,
): AgentPickerEntry[] {
  return [
    { id: 'agent', isActive: current === 'agent', title: strings.modeAgentLabel },
    { id: 'chat', isActive: current === 'chat', title: strings.modeChatLabel },
  ];
}
