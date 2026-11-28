import type { UserMemoryConfig } from '../engine/messages/types';

export const memoryPersonaRevision = async (persona: {
  narrative?: string | null;
  tagline?: string | null;
}) => {
  const bytes = new TextEncoder().encode(
    JSON.stringify([persona.narrative ?? '', persona.tagline ?? '']),
  );
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const memorySourceIds = async (config?: UserMemoryConfig): Promise<string[]> => {
  if (!config?.enabled || !config.memories) return [];
  const ids: string[] = [];
  for (const kind of [
    'activities',
    'contexts',
    'experiences',
    'identities',
    'preferences',
  ] as const) {
    for (const item of config.memories[kind] ?? []) {
      ids.push(
        item.id
          ? `memory:${kind}:${item.id}`
          : `unverified-memory:${await memoryPersonaRevision({ narrative: JSON.stringify(item) })}`,
      );
    }
  }
  if (config.memories.persona)
    ids.push(`memory-persona:${await memoryPersonaRevision(config.memories.persona)}`);
  return ids;
};

export const filterMemorySources = async (
  config: UserMemoryConfig | undefined,
  denied: Set<string>,
): Promise<UserMemoryConfig | undefined> => {
  if (!config?.memories) return config;
  const memories = { ...config.memories };
  for (const kind of [
    'activities',
    'contexts',
    'experiences',
    'identities',
    'preferences',
  ] as const) {
    const items = memories[kind];
    if (!items) continue;
    const allowed = await Promise.all(
      items.map(async (item) => {
        const source = item.id
          ? `memory:${kind}:${item.id}`
          : `unverified-memory:${await memoryPersonaRevision({ narrative: JSON.stringify(item) })}`;
        return !denied.has(source);
      }),
    );
    Object.assign(memories, { [kind]: items.filter((_, index) => allowed[index]) });
  }
  if (
    memories.persona &&
    denied.has(`memory-persona:${await memoryPersonaRevision(memories.persona)}`)
  )
    memories.persona = undefined;
  return { ...config, memories };
};
