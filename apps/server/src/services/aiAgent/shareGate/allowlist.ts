import { ChannelApiName, ChannelIdentifier } from '@lobechat/builtin-tool-channel';
import {
  AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS,
  isBuiltinToolIdentifier,
} from '@lobechat/builtin-tools';

/**
 * See `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`'s JSDoc in
 * `@lobechat/builtin-tools` for the full per-identifier evidence. Aliased here
 * so the two enforcement points below read as one local rule.
 */
export const SHARE_VISITOR_ALLOWED_IDENTIFIERS = AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS;

/**
 * Whether `identifier` belongs to the population this allowlist governs — the
 * real builtin tool registry (`@lobechat/builtin-tools`), the same source
 * `BuiltinToolsExecutor`/`hasServerRuntime` resolve against. MCP servers,
 * market plugins, and custom plugins never appear in this registry, so they
 * fall outside this allowlist's jurisdiction entirely and are left to
 * {@link filterPluginsByShareGate} / `shareConfig.toolGrants` — the
 * pre-existing (and unaffected) gate for that population.
 */
export const isGovernedByBuiltinAllowlist = isBuiltinToolIdentifier;

/**
 * The Channel APIs a shared Agent may call when a Channel runs it for a visitor. History reads see
 * the public timeline of that visitor's own conversation, which they already see. `listChannels`
 * and `postMessage` let the Agent reach people where it is itself a member: the run executes as
 * the owner, so both are narrowed to the owner's Channels the Agent is in, and a post there names
 * the visitor it was sent for (`ChannelPostService`). Every call re-authorizes against the run's
 * reserved Channel operation (`ChannelHistoryRepository`), so a share-page run, which has none,
 * reaches nothing. Everything else stays blocked, `sendMessage` included: it would ask the owner's
 * Agents as the owner.
 * Exempt from the owner's `toolGrants`, which picks the Agent's tools, not the Channel's.
 */
const SHARE_VISITOR_CHANNEL_APIS = new Set<string>([
  ChannelApiName.listChannels,
  ChannelApiName.postMessage,
  ChannelApiName.readMessage,
  ChannelApiName.readMessages,
]);

export const SHARE_VISITOR_CHANNEL_BLOCKED_APIS = new Set<string>(
  Object.values(ChannelApiName).filter((name) => !SHARE_VISITOR_CHANNEL_APIS.has(name)),
);

export const isShareVisitorChannelTool = (identifier: string) => identifier === ChannelIdentifier;

export const isShareVisitorChannelAllowed = (identifier: string, apiName: string) =>
  isShareVisitorChannelTool(identifier) && SHARE_VISITOR_CHANNEL_APIS.has(apiName);
