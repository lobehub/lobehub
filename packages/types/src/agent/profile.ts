/** The 16 Myers-Briggs types, as a closed set — new letters are not a thing. */
export const MBTI_TYPES = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const;

export type MbtiType = (typeof MBTI_TYPES)[number];

/** Western zodiac signs, in the conventional order. */
export const ZODIAC_SIGNS = [
  'aries',
  'taurus',
  'gemini',
  'cancer',
  'leo',
  'virgo',
  'libra',
  'scorpio',
  'sagittarius',
  'capricorn',
  'aquarius',
  'pisces',
] as const;

export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

/**
 * Presentation of the character, as far as artwork and pronoun-free copy are
 * concerned. Deliberately a small closed set so the prompt layer can key off
 * it; anything richer than these three belongs in `artworkDirection` or
 * `personaTraits`, which are free text.
 */
export const AGENT_GENDERS = ['female', 'male', 'neutral'] as const;

export type AgentGender = (typeof AGENT_GENDERS)[number];

/**
 * Who an agent *is*: the character sheet a user shapes and the artwork that
 * depicts it. One bag rather than a column per trait — none of this is ever a
 * query predicate, an index, or a join, and anything that becomes one belongs
 * in a real column instead (`name`, `title`, `avatar`, `societyId`).
 *
 * Traits are hints the prompt and artwork layers may use, never switches that
 * change behaviour.
 */
export interface AgentProfile {
  /**
   * Free-text direction the user last generated with ("a boy with glasses").
   * Kept so a regeneration reproduces the same character instead of silently
   * dropping what they asked for.
   */
  artworkDirection?: string;
  /**
   * A reference image the user attached themselves. Unlike a style preset — which
   * says "look like this kind of art" — this says "look like THIS character", so
   * a generation using it follows the reference instead of inventing a subject.
   */
  artworkReferenceImage?: string;
  /**
   * Id of the artwork style preset the current images were generated with, so
   * reopening the studio resumes where the user left off. Values are the
   * studio's own preset ids; the studio narrows the string it reads back.
   */
  artworkStyle?: string;
  /**
   * Head-to-toe artwork of the same character as the agent's avatar, stored as
   * a transparent PNG so large surfaces can composite it over their own
   * background.
   */
  fullBodyArtwork?: string;
  /** How the character presents; see {@link AGENT_GENDERS}. */
  gender?: AgentGender;
  /** Myers-Briggs type, e.g. `INFP`. */
  mbti?: MbtiType;
  /**
   * Free-form character labels ("毒舌", "话痨"). Open on purpose — the set is
   * whatever users invent, so it stays text rather than an enum, and any
   * faceted browsing over it reads the array rather than adding columns.
   */
  personaTraits?: string[];
  /** Western zodiac sign, e.g. `libra`. */
  zodiac?: ZodiacSign;
}
