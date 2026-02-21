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

    const expected = `<plugins description="The plugins you can use below">
<collection name="tool1">

<api identifier="api1">API 1</api>
</collection>
</plugins>`;

    expect(pluginPrompts({ tools })).toBe(expected);
  });

  it('should generate plugin prompts without tools', () => {
    const tools: Tool[] = [];

    const expected = `<plugins description="The plugins you can use below">

</plugins>`;

    expect(pluginPrompts({ tools })).toBe(expected);
  });
});
