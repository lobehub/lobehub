import {
  BOT_WAKE_SETTING_KEYS as KEY,
  DEFAULT_WAKE_RULES,
  MAX_BOT_WAKE_CHANNEL_LIST,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  MIN_COLLECT_SECONDS,
  MIN_COOLDOWN_SECONDS,
} from '@/server/services/agentSignal/scenarios/botWake/config';

import type { FieldSchema } from './types';

/** The user flag that decides whether the signed-in user sees these fields. */
const FEATURE_FLAG = 'enableBotWake';

const ENABLED = { field: KEY.enabled, value: true };

/** Visible lines of the custom-instructions text area. */
const CUSTOM_INSTRUCTIONS_ROWS = 10;

const channelList = (key: string, label: string): FieldSchema => ({
  key,
  default: [],
  description: `${label}Hint`,
  featureFlag: FEATURE_FLAG,
  label,
  // Matches the parser's own cap: an over-cap list is dropped wholesale, and for an allowlist
  // that silently means "unrestricted". The form refuses to grow or save past this number.
  maximum: MAX_BOT_WAKE_CHANNEL_LIST,
  type: 'array',
  visibleWhen: ENABLED,
  items: {
    key: 'item',
    label: '',
    type: 'object',
    properties: [
      {
        key: 'id',
        label: 'channel.botWakeChannelIdLabel',
        placeholder: 'channel.botWakeChannelIdPlaceholder',
        required: true,
        type: 'string',
      },
    ],
  },
});

/**
 * Options for letting the bot join a conversation nobody addressed to it, and for the rules,
 * classifier and scheduler that decide whether it should. With the master switch on they all
 * enforce: there is no "record only" or "off" to pick. Appended to a platform's `settings`
 * group; the form renders them flat, so each is a top-level key (see `BOT_WAKE_SETTING_KEYS`).
 *
 * Everything but the master switch stays hidden until `botWakeEnabled` is on, the scheduler's
 * timings until it is set to `enforce`, and the whole group until the `bot_wake` rollout reaches
 * the signed-in user.
 */
export const botWakeFields: FieldSchema[] = [
  {
    key: KEY.enabled,
    default: false,
    description: 'channel.botWakeEnabledHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeEnabled',
    type: 'boolean',
  },
  {
    key: KEY.scope,
    default: DEFAULT_WAKE_RULES.scope,
    description: 'channel.botWakeScopeHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeScope',
    type: 'string',
    visibleWhen: ENABLED,
    enum: ['all', 'bot-threads', 'none'],
    enumDescriptions: [
      'channel.botWakeScopeAllHint',
      'channel.botWakeScopeBotThreadsHint',
      'channel.botWakeScopeNoneHint',
    ],
    enumLabels: [
      'channel.botWakeScopeAll',
      'channel.botWakeScopeBotThreads',
      'channel.botWakeScopeNone',
    ],
  },
  channelList(KEY.allowChannels, 'channel.botWakeAllowChannels'),
  channelList(KEY.denyChannels, 'channel.botWakeDenyChannels'),
  {
    key: KEY.windowSeconds,
    default: DEFAULT_WAKE_RULES.windowSeconds,
    description: 'channel.botWakeWindowSecondsHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeWindowSeconds',
    maximum: 86_400,
    minimum: 0,
    type: 'number',
    visibleWhen: ENABLED,
  },
  {
    key: KEY.maxSilentWakes,
    default: DEFAULT_WAKE_RULES.maxSilentWakes,
    description: 'channel.botWakeMaxSilentWakesHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeMaxSilentWakes',
    maximum: 100,
    minimum: 0,
    type: 'integer',
    visibleWhen: ENABLED,
  },
  {
    key: KEY.ownerPresenceSeconds,
    default: DEFAULT_WAKE_RULES.ownerPresenceSeconds,
    description: 'channel.botWakeOwnerPresenceSecondsHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeOwnerPresenceSeconds',
    maximum: 86_400,
    minimum: 0,
    type: 'number',
    visibleWhen: ENABLED,
  },
  {
    key: KEY.classifierThreshold,
    default: DEFAULT_WAKE_RULES.classifier.threshold,
    description: 'channel.botWakeClassifierThresholdHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeClassifierThreshold',
    maximum: 1,
    minimum: 0,
    type: 'number',
    visibleWhen: ENABLED,
  },
  {
    key: KEY.proactiveEnabled,
    default: false,
    description: 'channel.botWakeProactiveEnabledHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeProactiveEnabled',
    type: 'boolean',
    visibleWhen: ENABLED,
  },
  {
    key: KEY.proactiveThreshold,
    default: DEFAULT_WAKE_RULES.proactive.threshold,
    description: 'channel.botWakeProactiveThresholdHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeProactiveThreshold',
    maximum: 1,
    minimum: 0,
    type: 'number',
    visibleWhen: { field: KEY.proactiveEnabled, value: true },
  },
  {
    key: KEY.customInstructions,
    description: 'channel.botWakeCustomInstructionsHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeCustomInstructions',
    placeholder: 'channel.botWakeCustomInstructionsPlaceholder',
    type: 'string',
    visibleWhen: ENABLED,
    // A prompt, not a label: the form gives it a text area instead of a one-line input.
    rows: CUSTOM_INSTRUCTIONS_ROWS,
    // Longer text is cut by the runtime, not rejected.
    maximum: MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  },
  {
    key: KEY.schedulerMode,
    default: 'off',
    description: 'channel.botWakeSchedulerModeHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeSchedulerMode',
    type: 'string',
    visibleWhen: ENABLED,
    enum: ['off', 'enforce'],
    enumDescriptions: ['channel.botWakeSchedulerOffHint', 'channel.botWakeSchedulerEnforceHint'],
    enumLabels: ['channel.botWakeSchedulerOff', 'channel.botWakeSchedulerEnforce'],
  },
  {
    key: KEY.collectSeconds,
    default: MIN_COLLECT_SECONDS,
    description: 'channel.botWakeCollectSecondsHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeCollectSeconds',
    maximum: 3600,
    minimum: MIN_COLLECT_SECONDS,
    type: 'number',
    visibleWhen: { field: KEY.schedulerMode, value: 'enforce' },
  },
  {
    key: KEY.cooldownSeconds,
    default: MIN_COOLDOWN_SECONDS,
    description: 'channel.botWakeCooldownSecondsHint',
    featureFlag: FEATURE_FLAG,
    label: 'channel.botWakeCooldownSeconds',
    maximum: 3600,
    minimum: MIN_COOLDOWN_SECONDS,
    type: 'number',
    visibleWhen: { field: KEY.schedulerMode, value: 'enforce' },
  },
];
