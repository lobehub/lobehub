import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';
import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';

import { buildHeteroAgentAction } from './heteroAgent';

describe('buildHeteroAgentAction', () => {
  it.each(HETEROGENEOUS_AGENT_CLIENT_CONFIGS)('builds a valid icon for $type', (config) => {
    const { icon } = buildHeteroAgentAction(config);

    expect(isValidElement(icon)).toBe(true);
    if (!isValidElement(icon)) throw new Error(`Expected a React element for ${config.type}`);
    expect(icon.type).toBeDefined();
  });
});
