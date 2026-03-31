import { describe, expect, it } from 'vitest';

import { pluginPrompts } from './index';
import type { Tool } from './tools';

describe('pluginPrompts', () => {
  it('should generate plugin prompts with tools', () => {
    const tools: Tool[] = [
      {
        name: 'tool1',
        identifier: 'id1',
        apis: [
          {
            name: 'api1',
            desc: 'API 1',
          },
        ],
      },
    ];

    const expected = `<tools description="The tools you can use below">
<tool name="tool1">no description</tool>
</tools>`;

    expect(pluginPrompts({ tools })).toBe(expected);
  });

  it('should generate plugin prompts without tools', () => {
    const tools: Tool[] = [];

    expect(pluginPrompts({ tools })).toBe('');
  });
});
