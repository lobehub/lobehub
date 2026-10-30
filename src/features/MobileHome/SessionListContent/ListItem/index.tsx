import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useHover } from 'ahooks';
import { memo, useMemo, useRef } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import GroupAvatar from '@/features/GroupAvatar';
import { useServerConfigStore } from '@/store/serverConfig';

import Item from './BaseListItem';
import type { ListItemProps } from './type';

const styles = stylex.create({
  container: {
    position: 'relative',
    marginBlock: '2px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '16px',
    borderRadius: cssVar.borderRadius,
  },
  mobile: { marginBlock: '0', paddingInlineStart: '12px', borderRadius: '0' },
  title: { lineHeight: 1.2 },
});

const ListItem = memo<
  Omit<ListItemProps, 'avatar' | 'key'> & {
    /** Seeds the generated avatar of an agent without one of its own. */
    agentId?: string;
    avatar: string | { avatar: string; background?: string }[];
    avatarBackground?: string;
    type?: 'agent' | 'group' | 'inbox';
  }
>(({ agentId, avatar, avatarBackground, active, showAction, actions, title, type, ...props }) => {
  const ref = useRef(null);
  const isHovering = useHover(ref);
  const mobile = useServerConfigStore((s) => s.isMobile);

  const avatarRender = useMemo(() => {
    if (type === 'group') {
      const avatars = Array.isArray(avatar) ? avatar : [avatar];
      return <GroupAvatar avatars={avatars} size={40} />;
    }

    const agentAvatar = typeof avatar === 'string' ? avatar : avatar[0]?.avatar;

    return (
      <AgentAvatar
        agentId={agentId}
        animation={isHovering}
        avatar={agentAvatar}
        background={avatarBackground}
        name={typeof title === 'string' ? title : undefined}
        shape={'circle'}
        size={40}
      />
    );
  }, [isHovering, agentId, avatar, avatarBackground, title, type]);

  return (
    <Item
      actions={actions}
      active={mobile ? false : active}
      avatar={avatarRender}
      className={stylex.props(styles.container, mobile && styles.mobile).className}
      ref={ref}
      showAction={actions && (isHovering || showAction || mobile)}
      title={<span {...stylex.props(styles.title)}>{title}</span>}
      {...(props as any)}
    />
  );
});

export default ListItem;
