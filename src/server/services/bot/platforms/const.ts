import { DEFAULT_LANG } from '@/const/locale';
import { type Locales, normalizeLocale } from '@/locales/resources';

import type { FieldSchema, ValidationResult } from './types';

export const displayToolCallsField: FieldSchema = {
  key: 'displayToolCalls',
  default: false,
  description: 'channel.displayToolCallsHint',
  label: 'channel.displayToolCalls',
  type: 'boolean',
};

/**
 * Per-platform "how to find this ID" tooltip keys. Each platform paints a
 * different path to the value the operator has to paste — Discord wants
 * Developer Mode + right-click, Telegram wants @userinfobot, Slack uses
 * profile menus, etc. The factory below picks the right key so the field's
 * `?` tooltip renders concrete steps; the inline `description` stays
 * platform-agnostic so it doesn't compete with the tooltip.
 *
 * Platforms not listed render no tooltip — only the generic description.
 */
const USER_ID_TOOLTIP_BY_PLATFORM: Record<string, string> = {
  discord: 'channel.userIdHint.discord',
  // Feishu and Lark share `sharedSchema`, which always passes 'feishu' — the
  // tooltip copy mentions both products so it reads naturally for either.
  feishu: 'channel.userIdHint.feishu',
  line: 'channel.userIdHint.line',
  qq: 'channel.userIdHint.qq',
  slack: 'channel.userIdHint.slack',
  telegram: 'channel.userIdHint.telegram',
};

const SERVER_ID_TOOLTIP_BY_PLATFORM: Record<string, string> = {
  discord: 'channel.serverIdHint.discord',
  slack: 'channel.serverIdHint.slack',
};

/**
 * Build the operator's "Default Server ID" field for `platform`. The inline
 * description stays generic; platform-specific "how to find" guidance lives
 * in the `?` tooltip next to the label.
 */
export function makeServerIdField(platform?: string): FieldSchema {
  return {
    key: 'serverId',
    description: 'channel.serverIdHint',
    label: 'channel.serverId',
    tooltip: platform ? SERVER_ID_TOOLTIP_BY_PLATFORM[platform] : undefined,
    type: 'string',
  };
}

/**
 * Build the operator's "Your Platform User ID" field for `platform`. See
 * {@link makeServerIdField} — same factory pattern, swapped vocabulary.
 */
export function makeUserIdField(platform?: string): FieldSchema {
  return {
    key: 'userId',
    description: 'channel.userIdHint',
    label: 'channel.userId',
    tooltip: platform ? USER_ID_TOOLTIP_BY_PLATFORM[platform] : undefined,
    type: 'string',
  };
}

// ---------- Bot reply locale ----------

/**
 * Locale used for **system-generated** bot reply text (errors, stopped notices,
 * DM rejection). Aliased to the project-wide `Locales` so adding a new IM
 * platform language doesn't drift from the rest of the codebase. Agent
 * conversation content is produced by the LLM and follows the user's language
 * naturally — this only governs the small set of static strings the bot
 * itself emits.
 *
 * Picked per-platform since each platform has a primary audience: Chinese
 * platforms (Feishu / QQ / WeChat) ship Chinese strings, the rest ship
 * English. Languages without an entry in the system-string dictionary
 * gracefully fall back to `DEFAULT_LANG` ('en-US') at render time.
 */
export type BotReplyLocale = Locales;

const PLATFORM_REPLY_LOCALES: Record<string, BotReplyLocale> = {
  discord: 'en-US',
  feishu: 'zh-CN',
  lark: 'en-US',
  qq: 'zh-CN',
  slack: 'en-US',
  telegram: 'en-US',
  wechat: 'zh-CN',
};

export function getBotReplyLocale(platform: string | undefined): BotReplyLocale {
  if (!platform) return DEFAULT_LANG;
  return PLATFORM_REPLY_LOCALES[platform] ?? DEFAULT_LANG;
}

/**
 * Coerce a platform-reported locale string to one of the project `Locales`.
 *
 * Different IM platforms emit different shapes for the same tag:
 * - Telegram: lowercase BCP 47 (`pt-br`, `zh-hans`)
 * - Discord / Slack: mixed case (`pt-BR`, `zh-CN`)
 * - Feishu / Lark: underscored (`zh_CN`)
 *
 * We re-format to `lang-REGION` and then defer to the project's
 * `normalizeLocale` so the resulting value sits inside `Locales`. Returns
 * `undefined` for falsy input so the caller can fall back to a platform
 * default; non-empty strings always produce a value (English when nothing
 * else matches).
 */
export function normalizeBotReplyLocale(
  raw: string | undefined | null,
): BotReplyLocale | undefined {
  if (!raw) return undefined;
  const parts = raw.replaceAll('_', '-').split('-');
  const lang = parts[0].toLowerCase();

  // BCP 47 script subtags for Chinese (Telegram emits `zh-hans` / `zh-hant`,
  // some web platforms emit `zh-Hans-CN` / `zh-Hant-TW`). `normalizeLocale`
  // only knows region tags, so a `zh-HANS` shape silently falls back to
  // en-US — map scripts to the closest regional locale before delegating.
  if (lang === 'zh' && parts.length >= 2) {
    const scriptOrRegion = parts[1].toLowerCase();
    if (scriptOrRegion === 'hans') return 'zh-CN';
    if (scriptOrRegion === 'hant') return 'zh-TW';
  }

  const formatted = parts.length === 1 ? lang : `${lang}-${parts[1].toUpperCase()}`;
  return normalizeLocale(formatted);
}

// ---------- Access policies (DM + Group) ----------

/**
 * Two access policies share the runtime: `dmPolicy` gates 1:1 DMs, and
 * `groupPolicy` gates group / channel / thread traffic. Both live as flat
 * top-level fields on `settings` because the channel form auto-generated by
 * `Body.tsx` flattens any `type: 'object'` field's children — nesting at the
 * schema layer would not survive serialization, and an earlier attempt at
 * `settings.dm.policy` silently fell through to the `'open'` fallback for
 * every saved channel.
 *
 * Allowlists are split by what they hold:
 * - `allowFrom` (top level, unprefixed) — **user IDs**. A *global* identity
 *   gate: when populated, **only** these users can interact with the bot
 *   anywhere — DMs, group @mentions, threads — regardless of `dmPolicy` /
 *   `groupPolicy` mode. Empty means "no user-level filter". Setting
 *   `dmPolicy='allowlist'` is an explicit "DMs require this list" signal
 *   that fails closed when the list is empty; otherwise the global gate
 *   already does the work.
 * - `groupAllowFrom` — **channel / group / thread IDs**. Owned by
 *   `groupPolicy` because the value type is unrelated to user IDs.
 *
 * The naming rule: a name without a scope prefix advertises that the value
 * crosses scopes (`allowFrom` is consulted by every gate); a prefixed name
 * advertises the field is the property of one specific scope.
 */
export type DmPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';

/** User-ID allowlist shared across user-scope policies (DM today). */
export interface UserAllowlist {
  /** Parsed, deduplicated platform user IDs. */
  ids: string[];
}

export interface DmSettings {
  policy: DmPolicy;
}

export type GroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface GroupSettings {
  /** Parsed channel / group / thread IDs (matched against `thread.channelId`). */
  allowFrom: string[];
  policy: GroupPolicy;
}

const DM_POLICIES: ReadonlySet<DmPolicy> = new Set(['open', 'allowlist', 'pairing', 'disabled']);
const GROUP_POLICIES: ReadonlySet<GroupPolicy> = new Set(['open', 'allowlist', 'disabled']);

/**
 * DM Policy: gate inbound 1:1 messages.
 *
 * - `open` (default): accept DMs from anyone (subject to the global
 *   `allowFrom` gate when that is populated)
 * - `allowlist`: DMs require the sender to be in the global `allowFrom`
 *   list. Distinct from `open` only when `allowFrom` is empty: `allowlist`
 *   then **fails closed** (no DMs), while `open` still lets anyone DM.
 * - `pairing`: same gate as `allowlist`, but a non-listed sender receives a
 *   one-time pairing code instead of a flat rejection. The owner approves
 *   via `/approve <code>`, which appends the applicant to `allowFrom` so
 *   subsequent DMs flow normally. Requires `settings.userId` (the owner's
 *   platform user ID, used both as approver identity and as the implicit
 *   "always allowed" sender for an empty allowFrom).
 * - `disabled`: ignore all DMs (the sender gets a one-line system reply
 *   pointing them at @mentioning the bot in a shared channel instead)
 */
export function makeDmPolicyField(defaults: { policy: DmPolicy }): FieldSchema {
  return {
    key: 'dmPolicy',
    default: defaults.policy,
    description: 'channel.dmPolicyHint',
    enum: ['open', 'allowlist', 'pairing', 'disabled'],
    enumDescriptions: [
      'channel.dmPolicyOpenHint',
      'channel.dmPolicyAllowlistHint',
      'channel.dmPolicyPairingHint',
      'channel.dmPolicyDisabledHint',
    ],
    enumLabels: [
      'channel.dmPolicyOpen',
      'channel.dmPolicyAllowlist',
      'channel.dmPolicyPairing',
      'channel.dmPolicyDisabled',
    ],
    label: 'channel.dmPolicy',
    type: 'string',
  };
}

/**
 * Global user-ID allowlist. Always visible — when populated, the runtime
 * applies it to **all** inbound traffic (DM and group), independently of
 * `dmPolicy` and `groupPolicy` mode. Empty means "no user-level filter".
 *
 * Tying visibility to `dmPolicy='allowlist'` was tried earlier and rejected
 * because it forced operators who only wanted to scope group @mentions to
 * also flip DM mode, which is misleading. Always-visible matches the
 * field's actual semantics.
 *
 * Stored as `Array<{ id, name? }>` so the operator can label each entry
 * (e.g. `name: '产品同事 Ada'`) and recognise IDs months later. The runtime
 * only consults `id` — see {@link parseIdList} for the back-compat parser
 * that still accepts the legacy comma-separated string and bare string[].
 */
export const allowFromField: FieldSchema = {
  key: 'allowFrom',
  default: [],
  description: 'channel.allowFromHint',
  label: 'channel.allowFrom',
  type: 'array',
  items: {
    key: 'item',
    label: '',
    type: 'object',
    properties: [
      {
        key: 'id',
        label: 'channel.allowFromIdLabel',
        placeholder: 'channel.allowFromIdPlaceholder',
        required: true,
        type: 'string',
      },
      {
        key: 'name',
        label: 'channel.allowFromNameLabel',
        placeholder: 'channel.allowFromNamePlaceholder',
        type: 'string',
      },
    ],
  },
};

/**
 * Group Policy: gate inbound non-DM traffic.
 *
 * - `open` (default): respond to @mentions in any group / channel / thread
 * - `allowlist`: respond only when `thread.channelId` is in
 *   `groupAllowFrom` — what users copy via Discord "Copy Channel ID",
 *   Telegram chat ID, Slack channel ID, etc.
 * - `disabled`: ignore all non-DM traffic
 */
export function makeGroupPolicyFields(defaults: { policy: GroupPolicy }): FieldSchema[] {
  return [
    {
      key: 'groupPolicy',
      default: defaults.policy,
      description: 'channel.groupPolicyHint',
      enum: ['open', 'allowlist', 'disabled'],
      enumDescriptions: [
        'channel.groupPolicyOpenHint',
        'channel.groupPolicyAllowlistHint',
        'channel.groupPolicyDisabledHint',
      ],
      enumLabels: [
        'channel.groupPolicyOpen',
        'channel.groupPolicyAllowlist',
        'channel.groupPolicyDisabled',
      ],
      label: 'channel.groupPolicy',
      type: 'string',
    },
    {
      key: 'groupAllowFrom',
      default: [],
      description: 'channel.groupAllowFromHint',
      label: 'channel.groupAllowFrom',
      type: 'array',
      items: {
        key: 'item',
        label: '',
        type: 'object',
        properties: [
          {
            key: 'id',
            label: 'channel.groupAllowFromIdLabel',
            placeholder: 'channel.groupAllowFromIdPlaceholder',
            required: true,
            type: 'string',
          },
          {
            key: 'name',
            label: 'channel.groupAllowFromNameLabel',
            placeholder: 'channel.groupAllowFromNamePlaceholder',
            type: 'string',
          },
        ],
      },
      visibleWhen: { field: 'groupPolicy', value: 'allowlist' },
    },
  ];
}

/**
 * Like {@link parseIdList} but preserves `name` so writers (e.g. the
 * pairing approval flow) can round-trip the operator-facing labels rather
 * than collapsing every entry to a bare ID. Same back-compat coverage:
 * accepts the current `{ id, name? }[]`, the legacy `string[]`, and the
 * original comma-separated string shape.
 */
export function normalizeAllowFromEntries(raw: unknown): Array<{ id: string; name?: string }> {
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id }));
  }
  if (Array.isArray(raw)) {
    const out: Array<{ id: string; name?: string }> = [];
    for (const entry of raw) {
      if (typeof entry === 'string') {
        const id = entry.trim();
        if (id) out.push({ id });
        continue;
      }
      if (entry && typeof entry === 'object' && 'id' in entry) {
        const id = (entry as { id?: unknown }).id;
        if (typeof id !== 'string' || !id.trim()) continue;
        const name = (entry as { name?: unknown }).name;
        out.push(
          typeof name === 'string' && name.trim()
            ? { id: id.trim(), name: name.trim() }
            : { id: id.trim() },
        );
      }
    }
    return out;
  }
  return [];
}

/**
 * Pull the platform IDs out of an allowlist value, regardless of which
 * historical shape it has on disk. Three shapes are all valid input:
 *
 * 1. `Array<{ id, name? }>` — current shape produced by the channel form,
 *    where `name` is an operator-facing label and `id` is what the runtime
 *    matches against. Only `id` is returned.
 * 2. `string[]` — legacy shape used briefly during the dm/group policy
 *    rollout, before names existed.
 * 3. `string` — original shape: comma / newline / whitespace-separated IDs
 *    pasted into a single text field.
 *
 * Empty / missing IDs are dropped. The caller (gating in `BotMessageRouter`)
 * never sees the names — those exist purely so the operator can recognise
 * each entry on the settings page.
 */
function parseIdList(raw: unknown): string[] {
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object' && 'id' in entry) {
          const id = (entry as { id?: unknown }).id;
          return typeof id === 'string' ? id.trim() : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  return [];
}

/** Read `settings.dmPolicy`. `mergeWithDefaults` injects the schema default
 *  in production; `'open'` is the safety net for malformed input. */
export function extractDmSettings(
  settings: Record<string, unknown> | null | undefined,
): DmSettings {
  const rawPolicy = settings?.dmPolicy as string | undefined;
  const policy: DmPolicy = DM_POLICIES.has(rawPolicy as DmPolicy)
    ? (rawPolicy as DmPolicy)
    : 'open';
  return { policy };
}

/**
 * Read the global user-ID allowlist from `settings.allowFrom`.
 *
 * When `allowFrom` is non-empty and `settings.userId` (the operator's own
 * platform ID, used by AI tools to push notifications back to them) is
 * also set, that operator ID is implicitly merged in so the operator
 * cannot accidentally lock themselves out by listing only their friends.
 *
 * Empty `allowFrom` short-circuits to "no filter" — populating only
 * `userId` does **not** flip the bot into private mode, which preserves
 * the original purpose of `userId` (AI-to-operator push) for everyone
 * who set it before `allowFrom` existed.
 */
export function extractUserAllowlist(
  settings: Record<string, unknown> | null | undefined,
): UserAllowlist {
  const explicit = parseIdList(settings?.allowFrom);
  if (explicit.length === 0) return { ids: [] };
  const operatorId = (settings?.userId as string | undefined)?.trim();
  if (!operatorId || explicit.includes(operatorId)) return { ids: explicit };
  return { ids: [...explicit, operatorId] };
}

/** Read `settings.groupPolicy` + `settings.groupAllowFrom`. */
export function extractGroupSettings(
  settings: Record<string, unknown> | null | undefined,
): GroupSettings {
  const rawPolicy = settings?.groupPolicy as string | undefined;
  const policy: GroupPolicy = GROUP_POLICIES.has(rawPolicy as GroupPolicy)
    ? (rawPolicy as GroupPolicy)
    : 'open';
  return { allowFrom: parseIdList(settings?.groupAllowFrom), policy };
}

/**
 * Global user-level gate. The router applies this **before** every per-scope
 * policy check, so a populated `allowFrom` restricts who can interact with
 * the bot anywhere — DMs, group @mentions, threads.
 *
 * - Empty `allowFrom` → no filter, anyone passes.
 * - Populated `allowFrom` → sender's user ID must be in the list. A missing
 *   `authorUserId` fails closed.
 */
export function shouldAllowSender(params: {
  authorUserId: string | undefined;
  userAllowlist: UserAllowlist;
}): boolean {
  const { authorUserId, userAllowlist } = params;
  if (userAllowlist.ids.length === 0) return true;
  if (!authorUserId) return false;
  return userAllowlist.ids.includes(authorUserId);
}

/**
 * Three-state outcome of the DM gate. `pair` is distinct from `reject`
 * because the router branches on it (issue a pairing code instead of
 * dropping the sender). Existing pass / fail call-sites can keep treating
 * `'pair'` as not-allow — the only thing that promotes pairing into a
 * useful behaviour is the router's pairing branch.
 */
export type DmDecision = 'allow' | 'pair' | 'reject';

/**
 * Gate inbound DM handling. Non-DM threads pass through unconditionally —
 * those are governed by `shouldHandleGroup` instead.
 *
 * Callers are expected to apply {@link shouldAllowSender} first, so this
 * function only encodes the per-scope semantics:
 *
 * - `policy='disabled'` → `'reject'` for everyone.
 * - `policy='open'` → `'allow'` (the global `allowFrom` filter, when
 *   populated, is enforced earlier by the caller).
 * - `policy='allowlist'` → `'allow'` for senders in `userAllowlist`,
 *   `'reject'` otherwise. Fails closed when the list is empty (this is
 *   the only behavioural difference from `open`).
 * - `policy='pairing'` → same gate as `allowlist`, but a non-listed sender
 *   gets `'pair'` instead of `'reject'` so the router can issue a pairing
 *   code. The owner (`operatorUserId`) is implicitly always allowed —
 *   without this, a fresh pairing bot with an empty allowFrom would refuse
 *   its own owner's DMs and they'd be told to ask themselves to approve.
 */
export function shouldHandleDm(params: {
  authorUserId: string | undefined;
  dmSettings: DmSettings;
  isDM: boolean;
  /**
   * The owning operator's platform user ID (`settings.userId`). Only
   * consulted under `pairing` policy, where the owner bypasses the
   * allowlist gate so they can DM their own bot before anyone is
   * approved. Pass `undefined` for non-pairing policies — the validator
   * already enforces presence at save time for pairing.
   */
  operatorUserId?: string;
  userAllowlist: UserAllowlist;
}): DmDecision {
  const { authorUserId, dmSettings, isDM, operatorUserId, userAllowlist } = params;
  if (!isDM) return 'allow';
  if (dmSettings.policy === 'disabled') return 'reject';
  if (dmSettings.policy === 'open') return 'allow';
  // allowlist & pairing share the same gate; they differ only on miss.
  if (!authorUserId) return 'reject';
  if (dmSettings.policy === 'pairing' && operatorUserId && authorUserId === operatorUserId) {
    return 'allow';
  }
  const inList = userAllowlist.ids.length > 0 && userAllowlist.ids.includes(authorUserId);
  if (inList) return 'allow';
  return dmSettings.policy === 'pairing' ? 'pair' : 'reject';
}

/**
 * Gate inbound group/channel handling. DM threads pass through
 * unconditionally — those are governed by `shouldHandleDm` instead.
 *
 * - `policy='disabled'` → ignore everything outside DMs.
 * - `policy='open'` → respond as before (existing @mention rules apply).
 * - `policy='allowlist'` → match if **any** candidate channel ID is in
 *   the configured list. The list of candidates exists because some
 *   platforms surface multiple IDs for one logical surface — Discord
 *   auto-creates a reply thread for each @-mention, so the inbound
 *   `thread.channelId` is the thread, but operators paste the *parent*
 *   channel ID into the allowlist. The router asks the PlatformClient
 *   to expand the candidate list (see `extraGroupAllowlistChannels`)
 *   and we accept any match. An empty/all-falsy candidate set fails
 *   closed.
 */
export function shouldHandleGroup(params: {
  candidateChannelIds: ReadonlyArray<string | undefined>;
  groupSettings: GroupSettings;
  isDM: boolean;
}): boolean {
  const { candidateChannelIds, groupSettings, isDM } = params;
  if (isDM) return true;
  if (groupSettings.policy === 'disabled') return false;
  if (groupSettings.policy === 'open') return true;
  // allowlist
  const candidates = candidateChannelIds.filter((id): id is string => Boolean(id));
  if (candidates.length === 0) return false;
  return candidates.some((id) => groupSettings.allowFrom.includes(id));
}

/**
 * Validate cross-platform access-policy settings at save time.
 *
 * Catches misconfigurations that would silently break runtime gating
 * before they hit the DB. Today this only enforces one rule:
 *
 * - `dmPolicy='pairing'` requires `settings.userId` (the owner's platform
 *   user ID). Without it nobody can issue `/approve`, so inbound pairing
 *   requests would land in a permanent limbo — surface the missing field
 *   at save time so operators don't paint themselves into the corner.
 *
 * Per-platform rules (e.g. Telegram bot tokens, Discord intents) belong
 * in `ClientFactory.validateSettings`; this function only encodes shared
 * invariants that apply regardless of platform.
 */
export function validateAccessSettings(
  settings: Record<string, unknown> | null | undefined,
): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const dmSettings = extractDmSettings(settings);
  if (dmSettings.policy === 'pairing') {
    const operatorId = (settings?.userId as string | undefined)?.trim();
    if (!operatorId) {
      errors.push({
        field: 'userId',
        message:
          "Pairing policy requires the owner's Platform User ID. Fill in 'Your Platform User ID' or pick a different DM Policy.",
      });
    }
  }
  return errors.length > 0 ? { errors, valid: false } : { valid: true };
}

// ---------- Step-aware reactions ----------

/**
 * Emoji shown on the user's message the moment the bot acknowledges it —
 * before the LLM has produced its first step. Cross-platform safe: accepted
 * by the Telegram Bot API's strict reaction allowlist plus Discord/Slack.
 */
export const RECEIVED_REACTION_EMOJI = '👀';

/**
 * Emoji shown on the user's message while the agent is reasoning/generating
 * (step_type=call_llm). Swapped in on the first step callback, replacing the
 * "received" emoji.
 */
export const THINKING_REACTION_EMOJI = '🤔';

/**
 * Emoji shown on the user's message while a tool call is executing
 * (step_type=call_tool with non-empty toolsCalling). `⚡` is used instead of
 * the more literal `🛠️` because Telegram rejects `🛠️` from its reaction
 * allowlist.
 */
export const WORKING_REACTION_EMOJI = '⚡';

/**
 * Given an `afterStep` event payload, predict the emoji to display while the
 * NEXT step is running. `afterStep` fires post-completion, so `stepType`
 * describes what just happened — we swap the reaction to match what's
 * coming:
 *
 * - `call_llm` that returned pending `toolsCalling` → the runtime is about
 *   to execute those tools → "working" emoji.
 * - `call_tool` → the runtime will feed results back into the LLM →
 *   "thinking" emoji.
 * - `call_llm` without tools → the final response is ready; `onComplete`
 *   clears immediately after, "thinking" is a sensible neutral for the
 *   brief window.
 *
 * The "received" emoji is set separately by the bridge on webhook arrival
 * and is not returned here.
 */
export function getStepReactionEmoji(stepType: string | undefined, toolsCalling: unknown): string {
  const toolsAboutToRun =
    stepType === 'call_llm' && Array.isArray(toolsCalling) && toolsCalling.length > 0;
  return toolsAboutToRun ? WORKING_REACTION_EMOJI : THINKING_REACTION_EMOJI;
}
