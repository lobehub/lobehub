import { parseGeneratedAgentAvatar, toGeneratedAgentAvatar } from './resolve';

/**
 * Seeds of the characters the avatar picker offers. Fixed, so every agent sees
 * the same set in the same order. Chosen so the set covers every silhouette
 * twice, in two different colors, and spreads the palette evenly.
 */
export const AGENT_CHARACTER_SEEDS = [
  'character-20',
  'character-19',
  'character-15',
  'character-8',
  'character-55',
  'character-5',
  'character-22',
  'character-16',
  'character-34',
  'character-10',
  'character-39',
  'character-6',
  'character-1',
  'character-13',
  'character-4',
  'character-17',
  'character-62',
  'character-9',
  'character-2',
  'character-31',
  'character-27',
  'character-30',
  'character-346',
  'character-52',
] as const;

export interface AgentCharacterOption {
  /** The `avatar` value picking this character writes. */
  avatar: string;
  seed: string;
  /** Whether the current avatar is this character. */
  selected: boolean;
}

/** The characters the picker offers, marking the one `value` picked. */
export const agentCharacterOptions = (value?: string | null): AgentCharacterOption[] => {
  const picked = parseGeneratedAgentAvatar(value);

  return AGENT_CHARACTER_SEEDS.map((seed) => ({
    avatar: toGeneratedAgentAvatar(seed),
    seed,
    selected: seed === picked,
  }));
};
