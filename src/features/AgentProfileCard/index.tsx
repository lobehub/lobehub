'use client';

import { Center, Flexbox, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import AgentAvatar, { isDefaultAgentAvatar } from '@/components/AgentAvatar';

const styles = stylex.create({
  banner: { position: 'relative', overflow: 'hidden', height: '60px' },
  bannerInner: { filter: 'blur(44px)' },
  clickableAvatar: { cursor: 'pointer' },
  clickableTitle: { cursor: 'pointer', color: { 'default': null, ':hover': cssVar.colorPrimary } },
  container: {
    overflow: 'hidden',
    width: '280px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  description: {
    overflow: 'hidden',
    maxHeight: '80px',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
  },
  header: { position: 'relative', marginBlockStart: '-24px', paddingInline: '16px' },
  name: { fontSize: '16px', fontWeight: 600, color: cssVar.colorText },
});

export interface AgentProfileCardProps {
  /** Seeds the generated avatar of an agent without one. */
  agentId?: string | null;
  avatar?: string | null;
  backgroundColor?: string | null;
  children?: ReactNode;
  description?: string | null;
  headerAction?: ReactNode;
  /** Show inline skeletons for fields that are still loading. */
  loading?: boolean;
  /** When set, avatar + title become clickable and trigger this handler. */
  onHeaderClick?: () => void;
  title: string;
}

const AgentProfileCard = memo<AgentProfileCardProps>(
  ({
    agentId,
    avatar,
    backgroundColor,
    description,
    headerAction,
    loading,
    onHeaderClick,
    title,
    children,
  }) => {
    return (
      <Flexbox className={stylex.props(styles.container).className}>
        <Center
          className={stylex.props(styles.banner).className}
          style={{ background: cssVar.colorFillTertiary }}
        >
          <AgentAvatar
            agentId={agentId}
            avatar={avatar}
            background={backgroundColor ?? undefined}
            className={stylex.props(styles.bannerInner).className}
            name={title}
            shape={'square'}
            size={400}
          />
        </Center>

        <Flexbox className={stylex.props(styles.header).className} gap={8}>
          <AgentAvatar
            agentId={agentId}
            avatar={avatar}
            background={backgroundColor ?? undefined}
            className={stylex.props(onHeaderClick ? styles.clickableAvatar : undefined).className}
            name={title}
            shape={'square'}
            size={48}
            // The generated character has no tile, so a frame would box empty space.
            style={
              isDefaultAgentAvatar(avatar)
                ? undefined
                : { border: `2px solid ${cssVar.colorBgElevated}` }
            }
            onClick={onHeaderClick}
          />
          <Flexbox gap={2}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Text
                ellipsis
                className={
                  stylex.props(styles.name, onHeaderClick && styles.clickableTitle).className
                }
                onClick={onHeaderClick}
              >
                {title}
              </Text>
              {headerAction}
            </Flexbox>
            {description ? (
              <Tooltip title={description}>
                <Text className={stylex.props(styles.description).className} ellipsis={{ rows: 2 }}>
                  {description}
                </Text>
              </Tooltip>
            ) : loading ? (
              <Skeleton.Text rows={2} width={['100%', '60%']} />
            ) : null}
          </Flexbox>
        </Flexbox>

        {children}
      </Flexbox>
    );
  },
);

export default AgentProfileCard;
