import { describe, expect, it } from 'vitest';

import enUS from '../../../../locales/en-US/plugin.json';
import plugin from './plugin';

describe('MCP App copy', () => {
  // en-US is mirrored by hand from the default source, so drift shows up as broken copy
  const keys = Object.keys(plugin).filter((key) => key.startsWith('mcpApp.'));

  it('covers the MCP App keys', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it.each(keys)('mirrors %s in en-US', (key) => {
    expect(enUS[key as keyof typeof enUS]).toBe(plugin[key as keyof typeof plugin]);
  });
});
