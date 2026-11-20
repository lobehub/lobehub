import { AgentAvatar as GeneratedAgentAvatar, type GroupAvatarProps } from '@lobehub/ui';

import { isDefaultAgentAvatar } from './resolve';

type StackAvatar = Exclude<NonNullable<GroupAvatarProps['avatars']>[number], string>;

const FILL_TILE = { height: '100%', width: '100%' };

/**
 * A member of a `GroupAvatar` stack. Without an avatar of its own it draws the
 * generated character; the stack sizes each tile, so the character fills it.
 */
export const toStackAvatar = <T extends StackAvatar & { seed?: string | null }>(
  { seed, ...member }: T,
  index: number,
): StackAvatar => {
  const { avatar } = member;
  if (typeof avatar !== 'string' ? !!avatar : !isDefaultAgentAvatar(avatar)) return member;

  return {
    ...member,
    avatar: <GeneratedAgentAvatar seed={seed || `member-${index}`} style={FILL_TILE} />,
    background: undefined,
  };
};
