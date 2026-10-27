import { describe, expect, it } from 'vitest';

import type { FieldSchema } from '@/server/services/bot/platforms/types';

import {
  dirtyModuleIds,
  discardPatch,
  moduleDirty,
  resolveSaveModules,
  settingsToSave,
  tabOfModule,
} from './saveModules';
import { groupSettingsFields } from './settingsGroups';

const field = (key: string): FieldSchema => ({ key, label: key, type: 'string' });
const groups = (keys: string[]) => groupSettingsFields(keys.map(field));

describe('resolveSaveModules', () => {
  const discord = groups([
    'connectionMode',
    'userId',
    'dmPolicy',
    'groupPolicy',
    'watchKeywords',
    'botWakeEnabled',
    'botWakeScope',
    'botWakeAllowChannels',
    'botWakeWindowSeconds',
    'botWakeCustomInstructions',
    'displayToolCalls',
    'reactionMode',
    'charLimit',
  ]);

  it('gives each block of the page a save of its own, in page order', () => {
    expect(resolveSaveModules(discord, true).map((m) => m.id)).toEqual([
      'credentials',
      'connection',
      'access',
      'wake-judgement',
      'wake-keywords',
      'wake-channels',
      'wake-pace',
      'advanced',
    ]);
  });

  it('leaves the replies out: they save themselves as soon as they change', () => {
    const keys = resolveSaveModules(discord, true).flatMap((m) => m.keys);

    expect(keys).not.toContain('displayToolCalls');
    expect(keys).not.toContain('reactionMode');
  });

  it('keeps every other option in exactly one module, so no setting has no save', () => {
    const all = ['connectionMode', 'userId', 'dmPolicy', 'groupPolicy', 'charLimit'];
    const placed = resolveSaveModules(groups(all), false).flatMap((m) => m.keys);

    expect(placed.sort()).toEqual([...all].sort());
  });

  it('has a credentials module only when the platform asks for credentials', () => {
    expect(resolveSaveModules(groups(['dmPolicy']), false).map((m) => m.id)).toEqual(['access']);
    expect(resolveSaveModules(groups(['dmPolicy']), true).map((m) => m.id)).toEqual([
      'credentials',
      'access',
    ]);
  });

  it('writes the hidden wake switch with every wake module, so the options stay on', () => {
    const wake = resolveSaveModules(discord, false).filter((m) => m.id.startsWith('wake-'));

    expect(wake.length).toBeGreaterThan(0);
    for (const module of wake) expect(module.alsoWrites).toEqual(['botWakeEnabled']);
  });

  it('maps a module to the tab it sits on', () => {
    expect(tabOfModule('credentials')).toBe('connect');
    expect(tabOfModule('connection')).toBe('connect');
    expect(tabOfModule('access')).toBe('access');
    expect(tabOfModule('wake-pace')).toBe('wake');
    expect(tabOfModule('advanced')).toBe('advanced');
  });
});

describe('module changes', () => {
  const modules = resolveSaveModules(
    groups(['dmPolicy', 'botWakeScope', 'botWakeWindowSeconds', 'charLimit']),
    true,
  );
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  const stored = {
    applicationId: 'app',
    credentials: { botToken: 'masked' },
    settings: { botWakeScope: 'all', botWakeWindowSeconds: 300, charLimit: 2000, dmPolicy: 'open' },
  };

  it('is clean when the form matches what is stored', () => {
    expect(dirtyModuleIds(modules, stored, stored)).toEqual([]);
  });

  it('marks only the module that holds the changed option', () => {
    const values = { ...stored, settings: { ...stored.settings, botWakeWindowSeconds: 120 } };

    expect(dirtyModuleIds(modules, values, stored)).toEqual(['wake-pace']);
    expect(moduleDirty(byId['wake-channels'], values, stored)).toBe(false);
  });

  it('marks the credentials module for a changed credential or application id', () => {
    expect(
      moduleDirty(byId.credentials, { ...stored, credentials: { botToken: 'new' } }, stored),
    ).toBe(true);
    expect(moduleDirty(byId.credentials, { ...stored, applicationId: 'other' }, stored)).toBe(true);
  });

  it('does not count an unset list as different from an empty one', () => {
    const lists = resolveSaveModules(groups(['botWakeAllowChannels']), false);
    const values = { settings: { botWakeAllowChannels: [] } };

    expect(dirtyModuleIds(lists, values, { settings: {} })).toEqual([]);
  });
});

describe('settingsToSave', () => {
  const modules = resolveSaveModules(
    groups(['botWakeEnabled', 'botWakeScope', 'botWakeWindowSeconds', 'charLimit']),
    false,
  );
  const byId = Object.fromEntries(modules.map((m) => [m.id, m]));
  const stored = {
    settings: {
      botWakeEnabled: true,
      botWakeScope: 'all',
      botWakeWindowSeconds: 300,
      charLimit: 2000,
    },
  };

  it('takes this module’s values and leaves every other option as stored', () => {
    // The window is edited and so is the character limit, but only the window's module is saved.
    const values = {
      settings: { ...stored.settings, botWakeWindowSeconds: 120, charLimit: 500 },
    };

    expect(settingsToSave(byId['wake-pace'], values, stored)).toEqual({
      botWakeEnabled: true,
      botWakeScope: 'all',
      botWakeWindowSeconds: 120,
      charLimit: 2000,
    });
  });

  it('keeps what no block owns, such as an operator’s nested mode override', () => {
    const override = { classifier: { mode: 'off' }, mode: 'shadow' };
    const withOverride = { settings: { ...stored.settings, botWake: override } };

    expect(settingsToSave(byId['wake-pace'], withOverride, withOverride).botWake).toEqual(override);
  });

  it('writes the wake switch from the form, so a bot saved before the options existed gets it', () => {
    const values = { settings: { ...stored.settings, botWakeEnabled: true } };

    expect(
      settingsToSave(byId['wake-pace'], values, { settings: { charLimit: 2000 } }).botWakeEnabled,
    ).toBe(true);
  });

  it('drops an option the form cleared instead of keeping the stored one', () => {
    const values = { settings: { botWakeEnabled: true, botWakeScope: 'all', charLimit: 2000 } };

    expect('botWakeWindowSeconds' in settingsToSave(byId['wake-pace'], values, stored)).toBe(false);
  });
});

describe('discardPatch', () => {
  const [, access] = resolveSaveModules(groups(['dmPolicy', 'groupPolicy']), true);

  it('puts back what is stored for this module’s options, and clears one that was never stored', () => {
    expect(discardPatch(access, { settings: { dmPolicy: 'open' } })).toEqual({
      groupPolicy: undefined,
      dmPolicy: 'open',
    });
  });
});
