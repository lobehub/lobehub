import { ON_DEMAND_BOOTSTRAP_ALLOWLIST, ON_DEMAND_BOOTSTRAP_IDENTIFIERS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildOnDemandBootstrapToolSet } from './bootstrapTooling';

describe('on-demand bootstrap tooling', () => {
  it('builds the same closed native tool surface for client and server', () => {
    const toolSet = buildOnDemandBootstrapToolSet();
    const expectedApiNames = ON_DEMAND_BOOTSTRAP_IDENTIFIERS.flatMap((identifier) =>
      ON_DEMAND_BOOTSTRAP_ALLOWLIST[identifier].map((apiName) => [identifier, apiName]),
    );

    expect(toolSet.enabledToolIds).toEqual(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);
    expect(toolSet.promptManifestMap).toEqual(toolSet.manifestMap);
    expect(toolSet.tools).toHaveLength(expectedApiNames.length);
    expect(toolSet.tools.map((tool) => tool.function.name)).toEqual(
      expectedApiNames.map(([identifier, apiName]) => `${identifier}____${apiName}`),
    );
    expect(toolSet.tools.every((tool) => !tool.function.name.endsWith('____invoke'))).toBe(true);
  });
});
