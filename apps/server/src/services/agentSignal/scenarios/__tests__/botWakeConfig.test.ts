// @vitest-environment node
import {
  BOT_WAKE_SETTING_KEYS,
  DEFAULT_WAKE_RULES,
  flattenBotWakeSettings,
  hasPassiveListeningRule,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  parseBotWakeSettings,
} from '../botWake/config';

describe('parseBotWakeSettings', () => {
  it.each([null, undefined, {}, { botWake: null }, { botWake: 'yes' }, { botWake: [] }])(
    'defaults for %j',
    (settings) => {
      const parsed = parseBotWakeSettings(settings as never);

      expect(parsed.rules).toEqual({ ...DEFAULT_WAKE_RULES, customInstructions: undefined });
      expect(parsed.ruleMode).toBe('enforce');
      expect(parsed.scheduler).toEqual({ collectMs: 20_000, cooldownMs: 60_000, mode: 'off' });
      expect(parsed.config.enabled).toBeUndefined();
    },
  );

  it('enforces the rules and the classifier whenever bot-wake is on', () => {
    const parsed = parseBotWakeSettings({ botWake: { enabled: true } });

    expect(parsed.ruleMode).toBe('enforce');
    expect(parsed.rules.classifier.mode).toBe('enforce');
    expect(
      parseBotWakeSettings({ botWake: { classifier: { threshold: 0.8 } } }).rules.classifier,
    ).toEqual({ initiateEnabled: true, initiateThreshold: 0.65, mode: 'enforce', threshold: 0.8 });
  });

  it('lets the owner switch helping others off, keeping the threshold', () => {
    const K = BOT_WAKE_SETTING_KEYS;
    const { classifier } = parseBotWakeSettings({
      [K.classifierInitiateEnabled]: false,
      [K.classifierInitiateThreshold]: 0.8,
      [K.enabled]: true,
    }).rules;

    expect(classifier).toMatchObject({ initiateEnabled: false, initiateThreshold: 0.8 });
  });

  it('hands the instructions to the classifier only while their switch is on, or was never set', () => {
    const K = BOT_WAKE_SETTING_KEYS;
    const text = { [K.customInstructions]: 'billing only', [K.enabled]: true };

    expect(parseBotWakeSettings(text).rules.customInstructions).toBe('billing only');
    expect(
      parseBotWakeSettings({ ...text, [K.customInstructionsEnabled]: true }).rules
        .customInstructions,
    ).toBe('billing only');
    expect(
      parseBotWakeSettings({ ...text, [K.customInstructionsEnabled]: false }).rules
        .customInstructions,
    ).toBeUndefined();
  });

  it('shows the instructions switch on in the form only for text written before it existed', () => {
    const K = BOT_WAKE_SETTING_KEYS;

    expect(flattenBotWakeSettings({ [K.customInstructions]: 'billing only' })).toMatchObject({
      [K.customInstructions]: 'billing only',
      [K.customInstructionsEnabled]: true,
    });
    // A choice the owner made stays, and no text means nothing to switch on.
    expect(
      flattenBotWakeSettings({
        [K.customInstructions]: 'billing only',
        [K.customInstructionsEnabled]: false,
      })?.[K.customInstructionsEnabled],
    ).toBe(false);
    expect(
      flattenBotWakeSettings({ [K.enabled]: true })?.[K.customInstructionsEnabled],
    ).toBeUndefined();
  });

  it('lets a confident classifier start a wake outside the window from 0.65, and 0 turns it off', () => {
    const K = BOT_WAKE_SETTING_KEYS;

    expect(parseBotWakeSettings({ [K.enabled]: true }).rules.classifier.initiateThreshold).toBe(
      0.65,
    );
    expect(
      parseBotWakeSettings({ [K.enabled]: true, [K.classifierInitiateThreshold]: 0 }).rules
        .classifier.initiateThreshold,
    ).toBe(0);
    expect(
      parseBotWakeSettings({ [K.classifierInitiateThreshold]: 2 }).rules.classifier
        .initiateThreshold,
    ).toBe(0.65);
  });

  it('ignores a mode an earlier form saved: the settings page no longer offers one', () => {
    const parsed = parseBotWakeSettings({
      botWakeClassifierMode: 'off',
      botWakeEnabled: true,
      botWakeMode: 'shadow',
    });

    expect(parsed.ruleMode).toBe('enforce');
    expect(parsed.rules.classifier.mode).toBe('enforce');
  });

  it('still lets a hand-written nested botWake ask for shadow or off, as an operator override', () => {
    const parsed = parseBotWakeSettings({
      botWake: { classifier: { mode: 'off' }, enabled: true, mode: 'shadow' },
    });

    expect(parsed.ruleMode).toBe('shadow');
    expect(parsed.rules.classifier.mode).toBe('off');
  });

  it('parses a full structured rule set', () => {
    const { rules, scheduler } = parseBotWakeSettings({
      botWake: {
        customInstructions: '  Only answer questions about billing.  ',
        enabled: true,
        rules: {
          allowChannels: ['c1', 22],
          denyChannels: ['c9'],
          maxSilentWakes: 2,
          ownerPresenceSeconds: 30,
          scope: 'bot-threads',
          windowSeconds: 90,
        },
        scheduler: { collectSeconds: 45, cooldownSeconds: 120, mode: 'enforce' },
      },
    });

    expect(rules).toMatchObject({
      allowChannels: ['c1', '22'],
      customInstructions: 'Only answer questions about billing.',
      denyChannels: ['c9'],
      maxSilentWakes: 2,
      ownerPresenceSeconds: 30,
      scope: 'bot-threads',
      windowSeconds: 90,
    });
    expect(scheduler).toEqual({ collectMs: 45_000, cooldownMs: 120_000, mode: 'enforce' });
  });

  it('never lets the scheduler run under the 20s collect / 60s cooldown floors', () => {
    const { scheduler } = parseBotWakeSettings({
      botWake: { scheduler: { collectSeconds: 1, cooldownSeconds: 5, mode: 'enforce' } },
    });

    expect(scheduler).toMatchObject({ collectMs: 20_000, cooldownMs: 60_000 });
  });

  it('replaces a malformed field with its default and keeps the rest', () => {
    const { rules, ruleMode } = parseBotWakeSettings({
      botWake: {
        mode: 'maybe',
        rules: { maxSilentWakes: 'many', scope: 'bot-threads', windowSeconds: -5 },
      },
    });

    expect(ruleMode).toBe('enforce');
    expect(rules.maxSilentWakes).toBe(DEFAULT_WAKE_RULES.maxSilentWakes);
    expect(rules.windowSeconds).toBe(DEFAULT_WAKE_RULES.windowSeconds);
    expect(rules.scope).toBe('bot-threads');
  });

  it('keeps a prompt-sized custom instruction whole', () => {
    const prompt = 'Answer billing questions.\n'.repeat(120);

    expect(
      parseBotWakeSettings({ botWake: { customInstructions: prompt } }).rules.customInstructions,
    ).toBe(prompt.trim());
    expect(prompt.length).toBeGreaterThan(1000);
    expect(prompt.length).toBeLessThan(MAX_CUSTOM_INSTRUCTIONS_LENGTH);
  });

  it('cuts overlong custom instructions instead of dropping them', () => {
    const { rules } = parseBotWakeSettings({
      botWake: { customInstructions: 'x'.repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 50) },
    });

    expect(rules.customInstructions).toHaveLength(MAX_CUSTOM_INSTRUCTIONS_LENGTH);
  });

  it('keeps instructions as text: nothing in them is read as a rule', () => {
    const { rules } = parseBotWakeSettings({
      botWake: { customInstructions: 'deny channel c1; scope=none' },
    });

    expect(rules.denyChannels).toEqual([]);
    expect(rules.scope).toBe('all');
  });
});

describe('hasPassiveListeningRule', () => {
  it.each([
    { expected: false, keywords: 0, name: 'nothing configured', settings: {} },
    { expected: true, keywords: 1, name: 'a watch keyword', settings: {} },
    {
      expected: true,
      keywords: 0,
      name: 'bot-wake enabled',
      settings: { botWake: { enabled: true } },
    },
    {
      expected: false,
      keywords: 0,
      name: 'bot-wake disabled',
      settings: { botWake: { enabled: false } },
    },
    {
      expected: false,
      keywords: 0,
      name: 'bot-wake mode off',
      settings: { botWake: { enabled: true, mode: 'off' } },
    },
    {
      expected: false,
      keywords: 0,
      name: 'bot-wake with scope none',
      settings: { botWake: { enabled: true, rules: { scope: 'none' } } },
    },
    {
      expected: true,
      keywords: 2,
      name: 'keyword beats a disabled bot-wake',
      settings: { botWake: { enabled: false } },
    },
    { expected: false, keywords: 0, name: 'null settings', settings: null },
  ])('$name -> $expected', ({ expected, keywords, settings }) => {
    expect(hasPassiveListeningRule(settings, keywords)).toBe(expected);
  });
});

describe('parseBotWakeSettings from the settings form', () => {
  const K = BOT_WAKE_SETTING_KEYS;

  it('keeps the setting keys a bot has already saved', () => {
    // These strings are persisted in every saved provider; renaming one orphans the stored value.
    expect(BOT_WAKE_SETTING_KEYS).toEqual({
      allowChannels: 'botWakeAllowChannels',
      classifierInitiateEnabled: 'botWakeClassifierInitiateEnabled',
      classifierInitiateThreshold: 'botWakeClassifierInitiateThreshold',
      classifierThreshold: 'botWakeClassifierThreshold',
      collectSeconds: 'botWakeCollectSeconds',
      cooldownSeconds: 'botWakeCooldownSeconds',
      customInstructions: 'botWakeCustomInstructions',
      customInstructionsEnabled: 'botWakeCustomInstructionsEnabled',
      denyChannels: 'botWakeDenyChannels',
      enabled: 'botWakeEnabled',
      maxSilentWakes: 'botWakeMaxSilentWakes',
      ownerPresenceSeconds: 'botWakeOwnerPresenceSeconds',
      pace: 'botWakePace',
      proactiveEnabled: 'botWakeProactiveEnabled',
      proactiveThreshold: 'botWakeProactiveThreshold',
      schedulerMode: 'botWakeSchedulerMode',
      scope: 'botWakeScope',
      windowSeconds: 'botWakeWindowSeconds',
    });
  });

  it('reads the flat keys the channel form writes', () => {
    const { config, rules, ruleMode, scheduler } = parseBotWakeSettings({
      [K.allowChannels]: [{ id: 'c1' }, { id: ' 22 ' }, { id: '' }],
      [K.classifierThreshold]: 0.7,
      [K.collectSeconds]: 40,
      [K.cooldownSeconds]: 90,
      [K.customInstructions]: '  Only billing questions.  ',
      [K.denyChannels]: [{ id: 'c9' }],
      [K.enabled]: true,
      [K.maxSilentWakes]: 1,
      [K.ownerPresenceSeconds]: 15,
      [K.proactiveEnabled]: true,
      [K.proactiveThreshold]: 0.8,
      [K.schedulerMode]: 'enforce',
      [K.scope]: 'bot-threads',
      [K.windowSeconds]: 60,
    });

    expect(config.enabled).toBe(true);
    expect(ruleMode).toBe('enforce');
    expect(rules).toEqual({
      allowChannels: ['c1', '22'],
      classifier: {
        initiateEnabled: true,
        initiateThreshold: 0.65,
        mode: 'enforce',
        threshold: 0.7,
      },
      customInstructions: 'Only billing questions.',
      denyChannels: ['c9'],
      maxSilentWakes: 1,
      ownerPresenceSeconds: 15,
      proactive: { mode: 'enforce', threshold: 0.8 },
      scope: 'bot-threads',
      windowSeconds: 60,
    });
    expect(scheduler).toEqual({ collectMs: 40_000, cooldownMs: 90_000, mode: 'enforce' });
  });

  it('offers the owner help by default, until they switch it off', () => {
    expect(parseBotWakeSettings({ [K.enabled]: true }).rules.proactive).toEqual({
      mode: 'enforce',
      threshold: 0.7,
    });
    expect(
      parseBotWakeSettings({ [K.enabled]: true, [K.proactiveEnabled]: false }).rules.proactive,
    ).toEqual({ mode: 'off', threshold: 0.7 });
    expect(
      parseBotWakeSettings({ [K.proactiveEnabled]: 'yes', [K.proactiveThreshold]: 3 }).rules
        .proactive,
    ).toEqual({ mode: 'enforce', threshold: 0.7 });
  });

  it('lets an operator only score offering help, beside the form options', () => {
    const settings = {
      [K.enabled]: true,
      [K.proactiveEnabled]: true,
      [K.proactiveThreshold]: 0.6,
      botWake: { proactive: { mode: 'shadow' } },
    };

    expect(parseBotWakeSettings(settings).rules.proactive).toEqual({
      mode: 'shadow',
      threshold: 0.6,
    });
    // The override has no flat key, so the form's projection keeps it nested.
    expect(flattenBotWakeSettings(settings)?.botWake).toEqual({ proactive: { mode: 'shadow' } });
  });

  it('treats an untouched form field as no choice, not as zero or empty', () => {
    const { rules } = parseBotWakeSettings({
      [K.classifierThreshold]: null,
      [K.customInstructions]: '',
      [K.maxSilentWakes]: undefined,
      [K.windowSeconds]: '',
    });

    expect(rules.classifier.threshold).toBe(DEFAULT_WAKE_RULES.classifier.threshold);
    expect(rules.customInstructions).toBeUndefined();
    expect(rules.maxSilentWakes).toBe(DEFAULT_WAKE_RULES.maxSilentWakes);
    expect(rules.windowSeconds).toBe(DEFAULT_WAKE_RULES.windowSeconds);
  });

  it('takes a nested botWake object as it is, so the form defaults saved beside it cannot switch it off', () => {
    // The channel form always saves its defaults, including `botWakeEnabled: false`.
    const { config, rules, ruleMode, scheduler } = parseBotWakeSettings({
      botWake: { enabled: true, rules: { scope: 'none', windowSeconds: 99 } },
      [K.enabled]: false,
      [K.scope]: 'all',
      [K.schedulerMode]: 'enforce',
      [K.windowSeconds]: 300,
    });

    expect(config.enabled).toBe(true);
    expect(ruleMode).toBe('enforce');
    expect(rules.scope).toBe('none');
    expect(rules.windowSeconds).toBe(99);
    expect(scheduler.mode).toBe('off');
  });

  it('reads the flat keys when botWake is not an object', () => {
    for (const botWake of [null, 'yes', [], 7]) {
      expect(
        parseBotWakeSettings({ botWake, [K.enabled]: true, [K.scope]: 'bot-threads' } as never)
          .rules.scope,
      ).toBe('bot-threads');
    }
  });

  it('keeps a cleared form from enabling anything', () => {
    expect(parseBotWakeSettings({ [K.enabled]: false }).config.enabled).toBe(false);
    expect(parseBotWakeSettings({ [K.enabled]: 'true' }).config.enabled).toBe(false);
  });

  it('counts a form-enabled bot as listening to messages nobody addressed to it', () => {
    expect(hasPassiveListeningRule({ [K.enabled]: true }, 0)).toBe(true);
    expect(hasPassiveListeningRule({ [K.enabled]: true, [K.scope]: 'none' }, 0)).toBe(false);
    expect(hasPassiveListeningRule({ [K.enabled]: false }, 0)).toBe(false);
  });
});

describe('flattenBotWakeSettings', () => {
  it('leaves settings without a nested botWake as they are, but for the pace the form shows', () => {
    const settings = { concurrency: 'queue', [BOT_WAKE_SETTING_KEYS.enabled]: true };

    expect(flattenBotWakeSettings(settings)).toEqual({
      ...settings,
      [BOT_WAKE_SETTING_KEYS.pace]: 'balanced',
    });
    const other = { concurrency: 'queue' };
    expect(flattenBotWakeSettings(other)).toBe(other);
    expect(flattenBotWakeSettings(null)).toBeNull();
    expect(flattenBotWakeSettings(undefined)).toBeUndefined();
    for (const botWake of ['yes', [], 7]) {
      expect(flattenBotWakeSettings({ botWake } as never)).toEqual({ botWake });
    }
  });

  it('expands every nested option onto the flat keys the form writes', () => {
    const nested = {
      classifier: { threshold: 0.8 },
      customInstructions: 'reply to release questions',
      enabled: true,
      rules: {
        allowChannels: [{ id: '100' }],
        denyChannels: ['200'],
        maxSilentWakes: 1,
        ownerPresenceSeconds: 60,
        scope: 'bot-threads',
        windowSeconds: 240,
      },
      scheduler: { cooldownSeconds: 90, collectSeconds: 30, mode: 'enforce' },
    };
    const K = BOT_WAKE_SETTING_KEYS;

    const flattened = flattenBotWakeSettings({ botWake: nested, concurrency: 'burst' });

    expect(flattened).toEqual({
      concurrency: 'burst',
      [K.allowChannels]: [{ id: '100' }],
      [K.classifierThreshold]: 0.8,
      [K.cooldownSeconds]: 90,
      [K.collectSeconds]: 30,
      [K.customInstructions]: 'reply to release questions',
      // Instructions written before their switch existed show it on, so a save keeps them live.
      [K.customInstructionsEnabled]: true,
      [K.denyChannels]: ['200'],
      [K.enabled]: true,
      [K.maxSilentWakes]: 1,
      [K.ownerPresenceSeconds]: 60,
      // Tuned numbers: the form shows them under a custom pace.
      [K.pace]: 'custom',
      [K.schedulerMode]: 'enforce',
      [K.scope]: 'bot-threads',
      [K.windowSeconds]: 240,
    });
    // The nested object is dropped so a save from the form migrates the row.
    expect(flattened).not.toHaveProperty('botWake');
  });

  it('shows untouched numbers as the balanced pace and tuned ones as custom', () => {
    const K = BOT_WAKE_SETTING_KEYS;

    expect(flattenBotWakeSettings({ [K.enabled]: true })?.[K.pace]).toBe('balanced');
    expect(
      flattenBotWakeSettings({ [K.enabled]: true, [K.schedulerMode]: 'enforce' })?.[K.pace],
    ).toBe('custom');
    expect(flattenBotWakeSettings({ [K.pace]: 'calm' })?.[K.pace]).toBe('calm');
  });

  it('runs a preset pace on its own numbers, and a custom or absent one on the saved numbers', () => {
    const K = BOT_WAKE_SETTING_KEYS;
    const tuned = { [K.enabled]: true, [K.schedulerMode]: 'enforce', [K.windowSeconds]: 90 };

    const calm = parseBotWakeSettings({ ...tuned, [K.pace]: 'calm' });
    expect(calm.rules).toMatchObject({
      maxSilentWakes: 1,
      ownerPresenceSeconds: 300,
      windowSeconds: 120,
    });
    expect(calm.scheduler).toEqual({ collectMs: 30_000, cooldownMs: 180_000, mode: 'enforce' });

    expect(parseBotWakeSettings({ ...tuned, [K.pace]: 'active' }).scheduler.mode).toBe('off');
    for (const pace of ['custom', undefined]) {
      const parsed = parseBotWakeSettings({ ...tuned, [K.pace]: pace });
      expect(parsed.rules.windowSeconds).toBe(90);
      expect(parsed.scheduler.mode).toBe('enforce');
    }
  });

  it('keeps the migrated row reading the same as the nested one', () => {
    const nested = {
      botWake: {
        classifier: { threshold: 0.8 },
        enabled: true,
        rules: { denyChannels: ['200'], scope: 'bot-threads' },
        scheduler: { mode: 'enforce' },
      },
    };

    // Read the same: the projection only adds what the form shows (a custom pace here).
    const { config: _migratedConfig, ...migrated } = parseBotWakeSettings(
      flattenBotWakeSettings(nested),
    );
    const { config: _nestedConfig, ...original } = parseBotWakeSettings(nested);
    expect(migrated).toEqual(original);
  });

  it('lets the nested values win over stale flat keys', () => {
    const K = BOT_WAKE_SETTING_KEYS;

    const flattened = flattenBotWakeSettings({
      [K.enabled]: false,
      [K.scope]: 'all',
      botWake: { enabled: true, rules: { scope: 'none' } },
    });

    // The stale flat keys are dropped too: the nested object never mentioned them, so leaving
    // them behind would switch the migrated row off on the next read.
    expect(flattened).toEqual({ [K.enabled]: true, [K.pace]: 'balanced', [K.scope]: 'none' });
  });
});

describe('an operator override of the modes', () => {
  const K = BOT_WAKE_SETTING_KEYS;
  const nested = {
    classifier: { mode: 'off', threshold: 0.8 },
    enabled: true,
    mode: 'shadow',
    rules: { scope: 'none', windowSeconds: 90 },
  };

  it('is kept when the settings are projected for the form, beside the flat options', () => {
    const flattened = flattenBotWakeSettings({ botWake: nested, concurrency: 'burst' });

    expect(flattened).toMatchObject({
      botWake: { classifier: { mode: 'off' }, mode: 'shadow' },
      concurrency: 'burst',
      [K.classifierThreshold]: 0.8,
      [K.enabled]: true,
      [K.scope]: 'none',
      [K.windowSeconds]: 90,
    });
    // Only the override stays nested: the options now live in the flat keys the form edits.
    expect(Object.keys((flattened as { botWake: object }).botWake).sort()).toEqual([
      'classifier',
      'mode',
    ]);
    expect((flattened as { botWake: { classifier: object } }).botWake.classifier).toEqual({
      mode: 'off',
    });
  });

  it('reads the same after the projection as before it', () => {
    const parsed = parseBotWakeSettings(flattenBotWakeSettings({ botWake: nested }));
    const original = parseBotWakeSettings({ botWake: nested });

    // What the pipeline acts on: the enabled switch, both modes, the rules and the scheduler.
    expect({
      enabled: parsed.config.enabled,
      rules: parsed.rules,
      ruleMode: parsed.ruleMode,
      scheduler: parsed.scheduler,
    }).toEqual({
      enabled: original.config.enabled,
      rules: original.rules,
      ruleMode: original.ruleMode,
      scheduler: original.scheduler,
    });
    expect(parsed.ruleMode).toBe('shadow');
    expect(parsed.rules.classifier.mode).toBe('off');
  });

  it('survives the form saving an unrelated change, and the form’s own edits still count', () => {
    const projected = flattenBotWakeSettings({ botWake: nested }) as Record<string, unknown>;
    // What the form writes back: everything it was given, with one option edited.
    const saved = { ...projected, [K.windowSeconds]: 60 };

    const parsed = parseBotWakeSettings(saved);
    expect(parsed.ruleMode).toBe('shadow');
    expect(parsed.rules.classifier.mode).toBe('off');
    expect(parsed.rules.windowSeconds).toBe(60);
  });

  it('applies to the flat options when the nested object is only the override', () => {
    const parsed = parseBotWakeSettings({
      botWake: { classifier: { mode: 'shadow' }, mode: 'off' },
      [K.enabled]: true,
      [K.scope]: 'bot-threads',
    });

    expect(parsed.config.enabled).toBe(true);
    expect(parsed.rules.scope).toBe('bot-threads');
    expect(parsed.ruleMode).toBe('off');
    expect(parsed.rules.classifier.mode).toBe('shadow');
  });

  it('is not invented: a nested config without modes projects without a nested object', () => {
    const flattened = flattenBotWakeSettings({
      botWake: { enabled: true, rules: { scope: 'none' } },
    });

    expect(flattened).not.toHaveProperty('botWake');
    expect(parseBotWakeSettings(flattened).ruleMode).toBe('enforce');
  });

  it('is not read from the flat keys an earlier form saved', () => {
    const parsed = parseBotWakeSettings({
      botWakeClassifierMode: 'off',
      botWakeEnabled: true,
      botWakeMode: 'shadow',
    });

    expect(parsed.ruleMode).toBe('enforce');
    expect(parsed.rules.classifier.mode).toBe('enforce');
  });
});
