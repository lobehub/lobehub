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
 * The Channel history reads a shared Agent may make when a Channel runs it for a visitor: the
 * public timeline of that visitor's own conversation, which they already see. Every read
 * re-authorizes against the run's reserved Channel operation (`ChannelHistoryRepository`), so a
 * share-page run, which has none, reads nothing. The messaging APIs (`listChannels`,
 * `sendMessage`, `listPeople`, `messagePerson`) stay blocked: the run executes as the owner, and
 * they would list or post into the owner's own Channels and conversations.
 * Exempt from the owner's `toolGrants`, which picks the Agent's tools, not the Channel's.
 */
const SHARE_VISITOR_CHANNEL_READ_APIS = new Set<string>([
  ChannelApiName.readMessage,
  ChannelApiName.readMessages,
]);

export const SHARE_VISITOR_CHANNEL_BLOCKED_APIS = new Set<string>(
  Object.values(ChannelApiName).filter((name) => !SHARE_VISITOR_CHANNEL_READ_APIS.has(name)),
);

export const isShareVisitorChannelTool = (identifier: string) => identifier === ChannelIdentifier;

export const isShareVisitorChannelRead = (identifier: string, apiName: string) =>
  isShareVisitorChannelTool(identifier) && SHARE_VISITOR_CHANNEL_READ_APIS.has(apiName);
