/**
 * Default personal names assigned to a freshly created agent.
 *
 * An agent's `name` is the identity it is addressed by ("Alice", "小艾"), while
 * `title` describes the role it plays ("Health Assistant"). A brand-new agent has
 * no role yet, so we seed a name immediately — it gives the agent a face in the
 * sidebar before the Agent Builder conversation has produced anything, and the
 * builder is free to replace it with one that fits the finished role.
 *
 * Names are deliberately plain and common: they should read as a person, not as
 * a product. Nothing here may collide with an assistant brand (Siri, Alexa,
 * Claude, Gemini, ...) or with LobeHub's own naming.
 */

const EN_AGENT_NAMES = [
  'Alice',
  'Amber',
  'Aria',
  'Bella',
  'Caleb',
  'Chloe',
  'Clara',
  'Daisy',
  'Elena',
  'Ellie',
  'Emma',
  'Ethan',
  'Felix',
  'Grace',
  'Hazel',
  'Henry',
  'Iris',
  'Ivy',
  'Jasper',
  'Julia',
  'Kai',
  'Lena',
  'Leo',
  'Lily',
  'Luna',
  'Mason',
  'Maya',
  'Milo',
  'Nina',
  'Noah',
  'Nora',
  'Oliver',
  'Owen',
  'Ruby',
  'Sophie',
  'Theo',
  'Vera',
  'Violet',
  'Wyatt',
  'Zoe',
];

const ZH_AGENT_NAMES = [
  '一诺',
  '亦安',
  '以宁',
  '佳宁',
  '允之',
  '俊驰',
  '初夏',
  '南星',
  '可欣',
  '向晚',
  '嘉树',
  '子墨',
  '子期',
  '安然',
  '宁远',
  '小满',
  '小艾',
  '思远',
  '慕言',
  '文渊',
  '斯年',
  '明轩',
  '星野',
  '晓风',
  '望舒',
  '朝颜',
  '林深',
  '柏舟',
  '沐白',
  '清和',
  '溪言',
  '焕之',
  '燕来',
  '知微',
  '秋澜',
  '若初',
  '谨言',
  '远航',
  '逸尘',
  '静姝',
];

/**
 * Pick a random display name for a new agent, matching the user's language.
 *
 * Any `zh-*` locale gets a Chinese name; everything else falls back to the
 * English pool, which reads acceptably across Latin-script locales. Traditional
 * Chinese (`zh-TW`) shares the simplified pool for now.
 *
 * `exclude` keeps the caller from handing out a name it already has in view —
 * two agents called "Alice" in one sidebar are indistinguishable. When every
 * candidate is excluded the full pool comes back rather than nothing: a repeat
 * name beats no name.
 */
export const randomAgentName = (locale?: string, exclude?: Iterable<string>): string => {
  const fullPool = locale?.toLowerCase().startsWith('zh') ? ZH_AGENT_NAMES : EN_AGENT_NAMES;

  const taken = new Set(
    [...(exclude ?? [])].map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  const available = taken.size > 0 ? fullPool.filter((n) => !taken.has(n.toLowerCase())) : fullPool;
  const pool = available.length > 0 ? available : fullPool;

  return pool[Math.floor(Math.random() * pool.length)];
};
