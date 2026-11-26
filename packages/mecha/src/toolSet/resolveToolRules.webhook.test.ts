import {
  AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS,
  alwaysOnToolIds,
  builtinTools,
  defaultToolIds,
  isAgentShareAllowedBuiltinIdentifier,
  runtimeManagedToolIds,
} from '@lobechat/builtin-tools';
import { getFeatureDisabledToolIds } from '@lobechat/builtin-tools/featureGates';
import { describe, expect, it } from 'vitest';

import { resolveDiscoveryPool } from './discoveryPool';
import { resolveToolRules } from './resolveToolRules';
import type { ToolRuleRequest } from './types';

// The tool's own identifier; mecha does not depend on the tool package.
const WEBHOOK = 'lobe-webhook';
const CHANNEL = 'lobe-channel';

/** The tool facts a server run assembles, with the `webhook` flag as the user resolves it. */
const run = ({
  enableWebhook,
  runtimePluginIds,
}: {
  enableWebhook?: boolean;
  runtimePluginIds?: string[];
}) => {
  const request: ToolRuleRequest = {
    agent: { chatConfig: {}, plugins: [] },
    // As `toolDiscovery` does: feature-gated tools leave the pool with the disabled ids.
    disabledPluginIds: getFeatureDisabledToolIds({ enableWebhook }),
    executionTarget: 'sandbox',
    localExecutionReady: false,
    model: { canUseFC: true },
    runtimePluginIds,
  };
  const rules = resolveToolRules(request);
  const pool = resolveDiscoveryPool({
    builtinTools,
    disabledPluginIds: request.disabledPluginIds,
    enabledManifests: new Map(),
    executionTarget: request.executionTarget,
  });
  return { pool, rules };
};

describe('webhook tool availability', () => {
  it('is not offered, discoverable or activatable while the webhook flag is off', () => {
    for (const enableWebhook of [undefined, false]) {
      const { pool, rules } = run({ enableWebhook });
      expect(rules.excludedIdentifiers.has(WEBHOOK)).toBe(true);
      expect(pool.manifestMap[WEBHOOK]).toBeUndefined();
      expect(pool.isManifestIngestAllowed(WEBHOOK)).toBe(false);
    }
  });

  it('is discoverable on demand with the flag on, never a default tool', () => {
    const { pool, rules } = run({ enableWebhook: true });
    expect(rules.excludedIdentifiers.has(WEBHOOK)).toBe(false);
    expect(pool.manifestMap[WEBHOOK]?.identifier).toBe(WEBHOOK);
    expect(rules.defaultToolIds).not.toContain(WEBHOOK);
    expect(rules.rules[WEBHOOK]).toBeUndefined();
    expect(defaultToolIds).not.toContain(WEBHOOK);
    expect(alwaysOnToolIds).not.toContain(WEBHOOK);
    expect(runtimeManagedToolIds).not.toContain(WEBHOOK);

    const registered = builtinTools.find((tool) => tool.identifier === WEBHOOK);
    expect(registered?.hidden).toBe(true);
    expect(registered?.discoverable).not.toBe(false);
  });

  it('is discoverable in a Channel run', () => {
    const { pool, rules } = run({ enableWebhook: true, runtimePluginIds: [CHANNEL] });
    expect(rules.rules[CHANNEL]).toBe(true);
    expect(pool.manifestMap[WEBHOOK]?.identifier).toBe(WEBHOOK);
  });

  it('is never granted to a share visitor', () => {
    expect(AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS.has(WEBHOOK)).toBe(false);
    expect(isAgentShareAllowedBuiltinIdentifier(WEBHOOK)).toBe(false);
  });
});
