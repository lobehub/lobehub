import { agentDisplayName } from '@lobechat/types';

import type { MessengerPlatform } from '@/config/messenger';
import { AgentModel } from '@/database/models/agent';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';

import { getMessengerSystemStrings } from '../systemReply';
import type { AgentPickerEntry } from '../types';
import type { AgentSummary, MessengerCommandContext, MessengerRouterDeps } from './types';
import { isWorkspaceFeatureEnabledForUser, PERSONAL_SCOPE_ID } from './utils';

/**
 * `/agents` is the single command for both listing agents and switching the
 * active one — on platforms that implement `sendAgentPicker` the bot replies
 * with a tap-to-switch keyboard. Platforms without keyboard support fall
 * back to a numbered text list + `/agents <n>` syntax for switching.
 *
 * Use when:
 * - A registered /agents text or slash command reaches the router.
 *
 * Expects:
 * - The context identifies whether Telegram can send interactive replies.
 *
 * Returns:
 * - A private selection response, or a safe DM instruction for Guest Mode.
 *
 * Triggering workflow / Call stack:
 *
 * {@link registerHandlers} / {@link handleSlashCommand}
 *   -> {@link buildCommands} (`/agents`)
 *     -> {@link runAgentsCommand}
 *       -> {@link MessengerCommandContext.reply} / {@link MessengerPlatformBinder.sendAgentPicker}
 */
export async function runAgentsCommand(
  deps: MessengerRouterDeps,
  ctx: MessengerCommandContext,
): Promise<void> {
  const { binder, chatId, link, serverDB } = ctx;
  const strings = getMessengerSystemStrings(ctx.platform);

  // Telegram Guest replies are visible in the originating chat. Redirect
  // before fetching personal data or switching state, including /agents <n>.
  if (ctx.platform === 'telegram' && !ctx.interactiveReplies) {
    await ctx.reply(strings.agentsDirectMessageOnly);
    return;
  }

  if (!link) {
    await ctx.reply(strings.needLink);
    return;
  }

  const userAgents = await deps.fetchUserAgents(serverDB, link.userId, link.workspaceId);
  if (userAgents.length === 0) {
    await ctx.reply(strings.agentsEmpty);
    return;
  }

  // Text-fallback path: `/agents 2` switches without needing the keyboard,
  // for platforms (or clients) where tap-buttons aren't available.
  const args = ctx.args.trim();
  if (args && (!binder.sendAgentPicker || !ctx.interactiveReplies)) {
    const index = Number.parseInt(args, 10);
    if (!Number.isInteger(index) || index < 1 || index > userAgents.length) {
      await ctx.reply(strings.agentsUsage(userAgents.length));
      return;
    }
    const target = userAgents[index - 1];
    if (link.activeAgentId === target.id) {
      await ctx.reply(strings.activeAgentAlready(target.title));
      return;
    }
    await MessengerAccountLinkModel.setActiveAgentById(serverDB, link.id, target.id);
    await ctx.reply(strings.activeAgentChanged(target.title));
    return;
  }

  if (binder.sendAgentPicker && ctx.interactiveReplies) {
    await binder.sendAgentPicker(chatId, {
      entries: toPickerEntries(userAgents, link.activeAgentId, strings),
      // Channel invocation → render ephemeral so only the invoker sees
      // their personal agent list (otherwise `/agents` from a public
      // channel would broadcast everyone's `LobeAI / Claude Code / …`
      // grid). DMs stay non-ephemeral so the picker persists in history.
      ephemeralTo: ctx.isDM ? undefined : ctx.authorUserId,
      // Discord-only: forward the slash interaction so the binder can
      // complete the deferred reply via the follow-up webhook. Without
      // this, Discord keeps "Thinking..." until it times out.
      interaction: ctx.interaction,
      text: strings.agentsPicker,
    });
    return;
  }

  // Final fallback: numbered list + usage hint for `/agents <n>`.
  await ctx.reply(renderAgentsList(userAgents, link.activeAgentId, strings));
}

/**
 * Render the numbered `/agents` text list. In a workspace scope where both
 * shared workspace agents and the caller's private agents are present, the
 * list splits into two headed sections (workspace first — matching the
 * `fetchUserAgents` partition) while keeping numbering continuous, so
 * `/agents <n>` still maps 1:1 onto the fetched array.
 */
export function renderAgentsList(
  userAgents: AgentSummary[],
  activeAgentId: string | null | undefined,
  strings: ReturnType<typeof getMessengerSystemStrings>,
): string {
  const line = (agent: AgentSummary, i: number) => {
    const marker = activeAgentId === agent.id ? ` (${strings.activeMarker})` : '';
    return `${i + 1}. ${agent.title}${marker}`;
  };

  const privateCount = userAgents.filter((agent) => agent.isPrivate).length;
  const grouped = privateCount > 0 && privateCount < userAgents.length;

  if (!grouped) {
    const lines = userAgents.map((agent, i) => line(agent, i));
    return `${strings.agentsHeading}\n${lines.join('\n')}\n\n${strings.agentsHint}`;
  }

  // `fetchUserAgents` already partitioned workspace-first, so the two
  // sections are contiguous slices and the shared numbering stays in order.
  const workspaceLines: string[] = [];
  const privateLines: string[] = [];
  for (const [i, agent] of userAgents.entries()) {
    (agent.isPrivate ? privateLines : workspaceLines).push(line(agent, i));
  }

  return [
    `${strings.agentsWorkspaceHeading}\n${workspaceLines.join('\n')}`,
    `${strings.agentsPrivateHeading}\n${privateLines.join('\n')}`,
    strings.agentsHint,
  ].join('\n\n');
}

/**
 * `/switch` changes the active *scope* of the IM session — personal or one
 * of the workspaces the user belongs to. The bot is a single shared bot, so
 * which LobeHub context a conversation runs in is the active agent's scope;
 * switching scope clears the active agent and the user re-picks via /agents.
 *
 * Mirrors `/agents`: on platforms that implement `sendAgentPicker` the bot
 * replies with a tap-to-switch keyboard (buttons emit `messenger:scope:<id>`
 * so the callback path can tell them apart from agent switches). Platforms
 * without keyboard support fall back to a numbered text list + `/switch <n>`.
 *
 * Use when:
 * - A registered /switch text or slash command reaches the router.
 *
 * Expects:
 * - The context identifies whether Telegram can send interactive replies.
 *
 * Returns:
 * - A private selection response, or a safe DM instruction for Guest Mode.
 *
 * Triggering workflow / Call stack:
 *
 * {@link registerHandlers} / {@link handleSlashCommand}
 *   -> {@link buildCommands} (`/switch`)
 *     -> {@link runSwitchCommand}
 *       -> {@link MessengerCommandContext.reply} / {@link MessengerPlatformBinder.sendAgentPicker}
 */
export async function runSwitchCommand(
  deps: MessengerRouterDeps,
  ctx: MessengerCommandContext,
): Promise<void> {
  const { binder, chatId, link, serverDB } = ctx;
  const strings = getMessengerSystemStrings(ctx.platform);

  // Telegram Guest replies are visible in the originating chat. Redirect
  // before fetching personal data or switching state, including /switch <n>.
  if (ctx.platform === 'telegram' && !ctx.interactiveReplies) {
    await ctx.reply(strings.switchDirectMessageOnly);
    return;
  }
  if (!link) {
    await ctx.reply(strings.needLink);
    return;
  }

  const scopes = await fetchUserScopes(serverDB, link.userId, ctx.platform);

  // Text-fallback path: `/switch 2` switches without needing the keyboard,
  // for platforms (or clients) where tap-buttons aren't available.
  const arg = ctx.args.trim();
  if (arg && (!binder.sendAgentPicker || !ctx.interactiveReplies)) {
    const index = Number.parseInt(arg, 10);
    if (!Number.isInteger(index) || index < 1 || index > scopes.length) {
      await ctx.reply(strings.scopesUsage(scopes.length));
      return;
    }
    const target = scopes[index - 1];
    if ((link.workspaceId ?? null) === target.id) {
      await ctx.reply(strings.scopeAlready(target.name));
      return;
    }
    const defaultAgent = await applyScopeSwitch(deps, serverDB, link.id, link.userId, target);
    await ctx.reply(strings.scopeSwitched(target.name, defaultAgent?.title));
    return;
  }

  if (binder.sendAgentPicker && ctx.interactiveReplies) {
    await binder.sendAgentPicker(chatId, {
      action: 'scope',
      entries: toScopeEntries(scopes, link.workspaceId ?? null),
      // Channel invocation → ephemeral so the user's personal workspace list
      // isn't broadcast (mirrors the `/agents` picker rationale).
      ephemeralTo: ctx.isDM ? undefined : ctx.authorUserId,
      // Discord-only: forward the slash interaction so the binder can
      // complete the deferred reply via the follow-up webhook.
      interaction: ctx.interaction,
      text: strings.scopePicker,
    });
    return;
  }

  // Final fallback: numbered list + usage hint for `/switch <n>`.
  const lines = scopes.map((scope, i) => {
    const marker = (link.workspaceId ?? null) === scope.id ? ` (${strings.currentMarker})` : '';
    return `${i + 1}. ${scope.name}${marker}`;
  });
  await ctx.reply(`${strings.scopesHeading}\n${lines.join('\n')}\n\n${strings.scopesHint}`);
}

/**
 * Resolve the user's switchable scopes: Personal (id `null`) followed by
 * each workspace they belong to.
 */
export async function fetchUserScopes(
  serverDB: LobeChatDatabase,
  userId: string,
  platform: MessengerPlatform,
): Promise<{ id: string | null; name: string }[]> {
  const personalScope = { id: null, name: getMessengerSystemStrings(platform).personalScope };
  if (!(await isWorkspaceFeatureEnabledForUser(userId))) return [personalScope];

  const workspaces = await new WorkspaceModel(serverDB, userId).listUserWorkspaces();
  return [personalScope, ...workspaces.map((w) => ({ id: w.id, name: w.name }))];
}

/**
 * Persist a scope switch and land on the new scope's default agent
 * (inbox/LobeAI is pinned first by `fetchUserAgents`) so switching never
 * leaves the session agent-less. Falls back to `null` only when the target
 * scope has no agents yet.
 */
export async function applyScopeSwitch(
  deps: MessengerRouterDeps,
  serverDB: LobeChatDatabase,
  linkId: string,
  userId: string,
  target: { id: string | null; name: string },
): Promise<AgentSummary | undefined> {
  const scopeAgents = await deps.fetchUserAgents(serverDB, userId, target.id);
  const defaultAgent = scopeAgents[0];
  await MessengerAccountLinkModel.setActiveScope(
    serverDB,
    linkId,
    target.id,
    defaultAgent?.id ?? null,
  );
  return defaultAgent;
}

export function toScopeEntries(
  scopes: { id: string | null; name: string }[],
  currentScopeId: string | null,
): AgentPickerEntry[] {
  return scopes.map((scope) => ({
    id: scope.id ?? PERSONAL_SCOPE_ID,
    isActive: scope.id === currentScopeId,
    title: scope.name,
  }));
}

/**
 * Button grids can't render section headings, so the workspace/private
 * distinction rides on the button label instead: private agents get a
 * localized suffix (e.g. `（私人）`). Only applied when the list actually
 * mixes both groups — an all-private or all-workspace list needs no marker.
 */
export function toPickerEntries(
  userAgents: AgentSummary[],
  activeAgentId: string | null | undefined,
  strings: ReturnType<typeof getMessengerSystemStrings>,
): AgentPickerEntry[] {
  const privateCount = userAgents.filter((agent) => agent.isPrivate).length;
  const marked = privateCount > 0 && privateCount < userAgents.length;

  return userAgents.map((agent) => ({
    id: agent.id,
    isActive: agent.id === activeAgentId,
    title: marked && agent.isPrivate ? `${agent.title}${strings.privateSuffix}` : agent.title,
  }));
}

/**
 * Fetch a user's agents for `/agents`. Mirrors the web
 * verify-im picker (and the home sidebar):
 *  - excludes virtual agents but explicitly keeps the inbox/LobeAI agent
 *  - orders by `updatedAt DESC`
 *  - pins inbox/LobeAI to the top regardless of updatedAt
 *  - applies the LobeAI title fallback (slug='inbox') and a generic
 *    "Custom Agent" fallback for agents without a title
 */
export async function fetchUserAgents(
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId?: string | null,
): Promise<AgentSummary[]> {
  // The filter, ordering, pinning, and title fallback all live in the model.
  // This text-only channel has no client-side i18n default, so it asks the
  // model to fill blank titles with a generic "Custom Agent" label, then
  // resolves name-over-title itself — there is no renderer downstream to do it.
  const rows = await new AgentModel(
    serverDB,
    userId,
    workspaceId ?? undefined,
  ).listMessengerBindableAgents({ fallbackTitle: 'Custom Agent' });

  // `fallbackTitle` guarantees a non-null label for every row.
  const summaries = rows.map((row) => ({
    id: row.id,
    isPrivate: row.isPrivate,
    title: agentDisplayName(row, 'Custom Agent'),
  }));

  // Workspace scope: stable-partition shared workspace agents ahead of the
  // caller's private ones so every surface (text list, pickers, the default
  // agent picked on scope switch) presents the two groups consistently.
  // Personal scope is untouched — `isPrivate` is always false there.
  return [
    ...summaries.filter((agent) => !agent.isPrivate),
    ...summaries.filter((agent) => agent.isPrivate),
  ];
}
