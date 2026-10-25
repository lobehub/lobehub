// @vitest-environment node
import {
  BOT_WAKE_SETTING_KEYS,
  DEFAULT_WAKE_RULES,
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
      expect(parsed.ruleMode).toBe('shadow');
      expect(parsed.scheduler).toEqual({ collectMs: 20_000, cooldownMs: 60_000, mode: 'off' });
      expect(parsed.config.enabled).toBeUndefined();
    },
  );

  it('keeps the classifier in shadow unless the owner says otherwise', () => {
    expect(parseBotWakeSettings({ botWake: { enabled: true } }).rules.classifier.mode).toBe(
      'shadow',
    );
    expect(
      parseBotWakeSettings({ botWake: { classifier: { mode: 'enforce', threshold: 0.8 } } }).rules
        .classifier,
    ).toEqual({ mode: 'enforce', threshold: 0.8 });
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

    expect(ruleMode).toBe('shadow');
    expect(rules.maxSilentWakes).toBe(DEFAULT_WAKE_RULES.maxSilentWakes);
    expect(rules.windowSeconds).toBe(DEFAULT_WAKE_RULES.windowSeconds);
    expect(rules.scope).toBe('bot-threads');
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
      classifierMode: 'botWakeClassifierMode',
      classifierThreshold: 'botWakeClassifierThreshold',
      collectSeconds: 'botWakeCollectSeconds',
      cooldownSeconds: 'botWakeCooldownSeconds',
      customInstructions: 'botWakeCustomInstructions',
      denyChannels: 'botWakeDenyChannels',
      enabled: 'botWakeEnabled',
      maxSilentWakes: 'botWakeMaxSilentWakes',
      mode: 'botWakeMode',
      ownerPresenceSeconds: 'botWakeOwnerPresenceSeconds',
      schedulerMode: 'botWakeSchedulerMode',
      scope: 'botWakeScope',
      windowSeconds: 'botWakeWindowSeconds',
    });
  });

  it('reads the flat keys the channel form writes', () => {
    const { config, rules, ruleMode, scheduler } = parseBotWakeSettings({
      [K.allowChannels]: [{ id: 'c1' }, { id: ' 22 ' }, { id: '' }],
      [K.classifierMode]: 'enforce',
      [K.classifierThreshold]: 0.7,
      [K.collectSeconds]: 40,
      [K.cooldownSeconds]: 90,
      [K.customInstructions]: '  Only billing questions.  ',
      [K.denyChannels]: [{ id: 'c9' }],
      [K.enabled]: true,
      [K.maxSilentWakes]: 1,
      [K.mode]: 'enforce',
      [K.ownerPresenceSeconds]: 15,
      [K.schedulerMode]: 'enforce',
      [K.scope]: 'bot-threads',
      [K.windowSeconds]: 60,
    });

    expect(config.enabled).toBe(true);
    expect(ruleMode).toBe('enforce');
    expect(rules).toEqual({
      allowChannels: ['c1', '22'],
      classifier: { mode: 'enforce', threshold: 0.7 },
      customInstructions: 'Only billing questions.',
      denyChannels: ['c9'],
      maxSilentWakes: 1,
      ownerPresenceSeconds: 15,
      scope: 'bot-threads',
      windowSeconds: 60,
    });
    expect(scheduler).toEqual({ collectMs: 40_000, cooldownMs: 90_000, mode: 'enforce' });
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
      botWake: { enabled: true, mode: 'enforce', rules: { scope: 'none', windowSeconds: 99 } },
      [K.enabled]: false,
      [K.mode]: 'shadow',
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
