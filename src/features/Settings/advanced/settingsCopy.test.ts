import { describe, expect, it } from 'vitest';

import setting from '@/locales/default/setting';

describe('settings copy', () => {
  it('uses non-repeating Advanced page group titles', () => {
    expect(setting['tab.advanced.toolsAndDiagnostics.title']).toBe('Tools and diagnostics');
    expect(setting['tab.advanced.updateChannel.title']).toBe('Update channel');
  });
});
