'use client';

import { Center, createStaticStyles, cssVar, Flexbox, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import AgentAvatar, { isDefaultAgentAvatar } from '@/components/AgentAvatar';

const styles = createStaticStyles(({ css, cssVar }) => ({
  banner: css`
    position: relative;
    overflow: hidden;
    height: 60px;
  `,
  bannerInner: css`
    filter: blur(44px);
  `,
  clickableAvatar: css`
    cursor: pointer;
  `,
  clickableTitle: css`
    cursor: pointer;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  container: css`
    overflow: hidden;
    width: 280px;
    background: ${cssVar.colorBgElevated};
  `,
  description: css`
    overflow: hidden;

    max-height: 80px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
  `,
  header: css`
    position: relative;
    margin-block-start: -24px;
    padding-inline: 16px;
  `,
  name: css`
    font-size: 16px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

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
      <Flexbox className={styles.container}>
        <Center className={styles.banner} style={{ background: cssVar.colorFillTertiary }}>
          <AgentAvatar
            agentId={agentId}
            avatar={avatar}
            background={backgroundColor ?? undefined}
            className={styles.bannerInner}
            name={title}
            shape={'square'}
            size={400}
          />
        </Center>

        <Flexbox className={styles.header} gap={8}>
          <AgentAvatar
            agentId={agentId}
            avatar={avatar}
            background={backgroundColor ?? undefined}
            className={onHeaderClick ? styles.clickableAvatar : undefined}
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
                className={`${styles.name} ${onHeaderClick ? styles.clickableTitle : ''}`}
                onClick={onHeaderClick}
              >
                {title}
              </Text>
              {headerAction}
            </Flexbox>
            {description ? (
              <Tooltip title={description}>
                <Text className={styles.description} ellipsis={{ rows: 2 }}>
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
