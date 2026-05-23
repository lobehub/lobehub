import { describe, expect, it } from 'vitest';

import onboarding from '@/locales/default/onboarding';
import setting from '@/locales/default/setting';

describe('settings copy', () => {
  it('describes Advanced tools without repeating Developer Mode wording', () => {
    expect(setting['settingCommon.devMode.title']).toBe('Advanced tools');
    expect(setting['settingCommon.devMode.desc']).toBe(
      'Show technical details and manual controls for chats, models, and local tools. This does not change model responses.',
    );
    expect(onboarding['proSettings.devMode.title']).toBe('Advanced tools');
  });

  it('uses non-repeating Advanced page group titles', () => {
    expect(setting['tab.advanced.toolsAndDiagnostics.title']).toBe('Tools and diagnostics');
    expect(setting['tab.advanced.appUpdates.title']).toBe('App updates');
    expect(setting['tab.advanced.updateChannel.title']).toBe('Update channel');
  });
});
