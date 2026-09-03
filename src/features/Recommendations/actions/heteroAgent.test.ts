import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';
import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';

import { RECOMMENDATION_ICON_SIZE } from '../iconSize';
import { buildHeteroAgentAction } from './heteroAgent';

describe('buildHeteroAgentAction', () => {
  it.each(HETEROGENEOUS_AGENT_CLIENT_CONFIGS)(
    'renders $type at the requested icon size',
    (config) => {
      const { renderIcon } = buildHeteroAgentAction(config);

      for (const size of Object.values(RECOMMENDATION_ICON_SIZE)) {
        const icon = renderIcon(size);

        expect(isValidElement(icon)).toBe(true);
        if (!isValidElement<{ size: number }>(icon)) {
          throw new Error(`Expected a React element for ${config.type}`);
        }
        expect(icon.props.size).toBe(size);
      }
    },
  );
});
