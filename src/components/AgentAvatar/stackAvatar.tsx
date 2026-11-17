import { AgentAvatar as GeneratedAgentAvatar, type GroupAvatarProps } from '@lobehub/ui';

import { isGeneratedAgentAvatar, parseGeneratedAgentAvatar } from './resolve';

type StackAvatar = Exclude<NonNullable<GroupAvatarProps['avatars']>[number], string>;

const FILL_TILE = { height: '100%', width: '100%' };

/**
 * A member of a `GroupAvatar` stack. Without an emoji or image of its own it
 * draws the generated character — the one it picked, else its seed's; the stack
 * sizes each tile, so the character fills it.
 */
export const toStackAvatar = <T extends StackAvatar & { seed?: string | null }>(
  { seed, ...member }: T,
  index: number,
): StackAvatar => {
  const { avatar } = member;
  if (typeof avatar !== 'string' ? !!avatar : !isGeneratedAgentAvatar(avatar)) return member;

  const characterSeed =
    (typeof avatar === 'string' && parseGeneratedAgentAvatar(avatar)) || seed || `member-${index}`;

  return {
    ...member,
    avatar: <GeneratedAgentAvatar seed={characterSeed} style={FILL_TILE} />,
    background: undefined,
  };
};
