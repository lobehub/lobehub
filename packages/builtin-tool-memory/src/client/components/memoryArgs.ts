/**
 * Shared normalization for memory tool-call arguments.
 *
 * Args reach the client straight from the model — no zod coercion, and possibly
 * half-streamed — so every field is treated as untrusted: a scalar may arrive where
 * an array is expected, scores may be strings, entities may have no name. Every
 * memory card derives its view model through these helpers so a dirty tool call
 * degrades into a thinner card instead of crashing the message.
 */

export interface MemoryEntity {
  /** Raw JSON metadata; surfaced on hover only, never inline. */
  extra?: string;
  name: string;
  type?: string;
}

/** Icons for the `UserMemoryContext*Type` and activity association enums. */
export const ENTITY_ICONS: Record<string, string> = {
  application: '💻',
  group: '👥',
  item: '📦',
  knowledge: '📚',
  other: '✨',
  person: '👤',
  pet: '🐾',
  place: '📍',
};

export const FALLBACK_ENTITY_ICON = '✨';

export const asText = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const asArray = (value: unknown) => (Array.isArray(value) ? value : []);

/** Keep only the usable strings out of a list that may not even be a list. */
export const asTextList = (value: unknown): string[] =>
  asArray(value).filter((item): item is string => !!asText(item));

/** A 0–1 model score as a whole percentage, clamped; `undefined` when unusable. */
export const toPercent = (score: unknown) =>
  typeof score === 'number' && Number.isFinite(score)
    ? Math.round(Math.min(Math.max(score, 0), 1) * 100)
    : undefined;

const toEntity = (value: unknown): MemoryEntity | undefined => {
  const name = asText((value as MemoryEntity | undefined)?.name);
  if (!name) return undefined;

  return {
    extra: asText((value as MemoryEntity).extra),
    name,
    type: asText((value as MemoryEntity).type),
  };
};

/** Flatten several association lists into one clean, named-entity-only list. */
export const toEntities = (...lists: unknown[]): MemoryEntity[] =>
  lists
    .flatMap((list) => asArray(list))
    .map((entity) => toEntity(entity))
    .filter((entity): entity is MemoryEntity => !!entity);
