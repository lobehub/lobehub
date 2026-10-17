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
