'use client';

import { Avatar, Center, Flexbox, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';

import { DEFAULT_AVATAR } from '@/const/meta';

const styles = createStaticStyles(({ css, cssVar }) => ({
  banner: css`
    position: relative;
    overflow: hidden;
    height: 60px;
  `,
  bannerInner: css`
    filter: blur(44px);
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
  descriptionSkeleton: css`
    .ant-skeleton-paragraph {
      margin-block-start: 4px !important;
    }

    .ant-skeleton-paragraph > li {
      height: 12px !important;
    }

    .ant-skeleton-paragraph > li + li {
      margin-block-start: 6px !important;
    }
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
  avatar?: string | null;
  backgroundColor?: string | null;
  children?: ReactNode;
  description?: string | null;
  headerAction?: ReactNode;
  /** Show inline skeletons for fields that are still loading. */
  loading?: boolean;
  title: string;
}

const AgentProfileCard = memo<AgentProfileCardProps>(
  ({ avatar, backgroundColor, description, headerAction, loading, title, children }) => {
    return (
      <Flexbox className={styles.container}>
        <Center className={styles.banner} style={{ background: cssVar.colorFillTertiary }}>
          <Avatar
            emojiScaleWithBackground
            avatar={avatar || DEFAULT_AVATAR}
            background={backgroundColor ?? undefined}
            className={styles.bannerInner}
            shape={'square'}
            size={400}
          />
        </Center>

        <Flexbox className={styles.header} gap={8}>
          <Avatar
            emojiScaleWithBackground
            avatar={avatar || DEFAULT_AVATAR}
            background={backgroundColor ?? undefined}
            shape={'square'}
            size={48}
            style={{ border: `2px solid ${cssVar.colorBgElevated}` }}
          />
          <Flexbox gap={2}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Text ellipsis className={styles.name}>
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
              <Skeleton
                active
                className={styles.descriptionSkeleton}
                paragraph={{ rows: 2, width: ['100%', '60%'] }}
                title={false}
              />
            ) : null}
          </Flexbox>
        </Flexbox>

        {children}
      </Flexbox>
    );
  },
);

export default AgentProfileCard;
