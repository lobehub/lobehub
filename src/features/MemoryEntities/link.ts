import { type MemoryActivity, type MemoryEntity, type NameLink } from './types';

const key = (name: string) => name.trim().toLowerCase();

/**
 * Names that show up in more than this share of a user's contexts (the user's own name, their
 * company) tie everything to everything. Sampled production data: with them dropped, ~22% of
 * contexts get at least one timeline entry, median 2.
 */
const HUB_SHARE = 0.2;
/**
 * Names found only by scanning a context's text are noisier (generic words such as 「仓库」
 * match anywhere), so they drop out at a lower share.
 */
const TEXT_HUB_SHARE = 0.05;
const HUB_MIN = 2;
/**
 * Role words the extractor records as participants on almost every activity. They are frequent
 * enough to mislink pages but often stay under the hub share for a single user.
 */
const STOP_NAMES = new Set([
  'agent',
  'ai',
  'assistant',
  'bot',
  'me',
  'system',
  'user',
  'the user',
  '助手',
  '助理',
  '我',
  '用户',
  '系统',
]);
/** Shorter names ("AI", "Go") match inside unrelated words. */
const MIN_TEXT_MATCH_LENGTH = 2;

const escape = (text: string) => text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

/**
 * Latin names match as whole words ("Mac" must not hit "machine"); CJK text has no word
 * boundaries, so those names match as substrings.
 */
const wordPatterns = new Map<string, RegExp>();
/**
 * Whether a context's text mentions an activity name. CJK names have no word boundaries and
 * match as substrings. Latin names only count when they read as proper nouns ("Composio",
 * "LobeHub", not "workspace" or "git") and appear as whole words with the same casing.
 */
const containsName = (text: string, lowerText: string, label: string) => {
  if (!/[\dA-Z]/i.test(label)) return lowerText.includes(label.toLowerCase());
  if (!/[A-Z]/.test(label) || !text.includes(label)) return false;
  let pattern = wordPatterns.get(label);
  if (!pattern) {
    pattern = new RegExp(`(^|[^\\dA-Za-z])${escape(label)}($|[^\\dA-Za-z])`);
    wordPatterns.set(label, pattern);
  }
  return pattern.test(text);
};

const textOf = (entity: MemoryEntity) =>
  [entity.title, entity.summary, entity.description, ...entity.tags].join('\n');

/**
 * What a context mentions: its own associated names when the backend sends them, plus every
 * activity name that appears in its title, summary, description or tags. The second half keeps
 * pages linked while the list endpoint omits context names.
 */
export const mentionsOf = (entities: MemoryEntity[], activities: MemoryActivity[]) => {
  const vocabulary = new Map<string, string>();
  for (const activity of activities) {
    for (const n of activity.names) {
      const k = key(n.name);
      if ([...k].length < MIN_TEXT_MATCH_LENGTH || STOP_NAMES.has(k)) continue;
      // Keep the capitalised spelling when both appear, so proper nouns are recognised.
      const known = vocabulary.get(k);
      if (!known || (!/[A-Z]/.test(known) && /[A-Z]/.test(n.name))) vocabulary.set(k, n.name);
    }
  }

  const mentions: Mentions = new Map();
  for (const entity of entities) {
    const found = new Map<string, Mention>();
    for (const n of entity.names)
      if (!STOP_NAMES.has(key(n.name)))
        found.set(key(n.name), { fromText: false, label: n.name });
    found.set(key(entity.title), { fromText: false, label: entity.title });
    const text = textOf(entity);
    const lowerText = text.toLowerCase();
    for (const [k, label] of vocabulary)
      if (!found.has(k) && containsName(text, lowerText, label))
        found.set(k, { fromText: true, label });
    mentions.set(entity.id, found);
  }
  return mentions;
};

interface Mention {
  fromText: boolean;
  label: string;
}
type Mentions = Map<string, Map<string, Mention>>;

export const hubNamesOf = (mentions: Mentions) => {
  const counts = new Map<string, { any: number; text: number }>();
  for (const found of mentions.values()) {
    for (const [k, m] of found) {
      const c = counts.get(k) ?? { any: 0, text: 0 };
      c.any += 1;
      if (m.fromText) c.text += 1;
      counts.set(k, c);
    }
  }
  const limit = Math.max(HUB_MIN, mentions.size * HUB_SHARE);
  const textLimit = Math.max(HUB_MIN, mentions.size * TEXT_HUB_SHARE);
  return new Set(
    [...counts].filter(([, c]) => c.any > limit || c.text > textLimit).map(([k]) => k),
  );
};

export interface EntityLinks {
  /** contextId → activities that mention one of its names, most recent first. */
  activities: Map<string, { activity: MemoryActivity; names: string[] }[]>;
  /** contextId → other contexts sharing a name. */
  contexts: Map<string, NameLink[]>;
  /** contextId → names the page mentions, after dropping the ones every page mentions. */
  mentions: Map<string, string[]>;
}

/**
 * The backend stores no context ↔ activity link, so infer one from the names both mention.
 */
export const linkByNames = (
  entities: MemoryEntity[],
  activities: MemoryActivity[],
): EntityLinks => {
  const mentions = mentionsOf(entities, activities);
  const hubs = hubNamesOf(mentions);

  const nameIndex = new Map<string, string[]>();
  const kept = new Map<string, string[]>();
  for (const [id, found] of mentions) {
    const labels: string[] = [];
    for (const [k, { label }] of found) {
      if (hubs.has(k)) continue;
      labels.push(label);
      nameIndex.set(k, [...(nameIndex.get(k) ?? []), id]);
    }
    kept.set(id, labels);
  }

  const byContext = new Map<string, { activity: MemoryActivity; names: string[] }[]>();
  for (const activity of activities) {
    const hits = new Map<string, string[]>();
    for (const n of activity.names) {
      for (const id of nameIndex.get(key(n.name)) ?? []) {
        const names = hits.get(id) ?? [];
        if (!names.includes(n.name)) names.push(n.name);
        hits.set(id, names);
      }
    }
    for (const [id, names] of hits) {
      byContext.set(id, [...(byContext.get(id) ?? []), { activity, names }]);
    }
  }
  for (const list of byContext.values())
    list.sort((a, b) => b.activity.when.localeCompare(a.activity.when));

  const contexts = new Map<string, NameLink[]>();
  for (const [id, labels] of kept) {
    const shared = new Map<string, string[]>();
    for (const label of labels) {
      for (const targetId of nameIndex.get(key(label)) ?? []) {
        if (targetId === id) continue;
        shared.set(targetId, [...(shared.get(targetId) ?? []), label]);
      }
    }
    contexts.set(
      id,
      [...shared]
        .map(([targetId, names]) => ({ names: [...new Set(names)], targetId }))
        .sort((a, b) => b.names.length - a.names.length),
    );
  }

  return { activities: byContext, contexts, mentions: kept };
};
