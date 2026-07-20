'use client';

import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback } from 'react';
import urlJoin from 'url-join';

import Rate from '@/components/RatingOverview/Rate';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { type DiscoverSkillItem } from '@/types/discover';

import { useDetailActionContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    border-color: ${cssVar.colorBorderSecondary} !important;
    border-radius: 16px !important;
    background: ${cssVar.colorBgContainer} !important;
    transition:
      transform 0.2s ease,
      border-color 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      transform: translateY(-1px);
      border-color: ${cssVar.colorBorder} !important;
      box-shadow: 0 10px 28px color-mix(in srgb, ${cssVar.colorText} 8%, transparent);
    }

    &:active {
      transform: translateY(0);
    }
  `,
  meta: css`
    overflow: hidden;

    min-width: 0;

    font-size: 13px;
    color: ${cssVar.colorTextDescription};
    white-space: nowrap;
  `,
  metaAuthor: css`
    overflow: hidden;
    flex: 1 1 auto;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  metaRating: css`
    flex: none;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  `,
  name: css`
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
  `,
}));

const RelatedSkillCard = memo<DiscoverSkillItem>(
  ({ name, identifier, author, icon, ratingAvg }) => {
    const { selectSkill } = useDetailActionContext();
    const navigate = useWorkspaceAwareNavigate();

    const displayRating =
      typeof ratingAvg === 'number' && ratingAvg > 0 ? Number(ratingAvg.toFixed(1)) : undefined;

    const handleClick = useCallback(() => {
      if (selectSkill) {
        selectSkill(identifier);
        return;
      }
      navigate(urlJoin('/community/skill', identifier));
    }, [identifier, navigate, selectSkill]);

    return (
      <Block
        clickable
        className={styles.card}
        paddingBlock={12}
        paddingInline={14}
        variant={'outlined'}
        onClick={handleClick}
      >
        <Flexbox horizontal align={'center'} gap={12}>
          <Avatar avatar={icon || name || identifier} size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Text ellipsis className={styles.name}>
              {name || identifier}
            </Text>
            <Flexbox horizontal align={'center'} className={styles.meta} gap={4}>
              {author && <span className={styles.metaAuthor}>{author}</span>}
              {displayRating && (
                <Flexbox horizontal align={'center'} className={styles.metaRating} gap={3}>
                  {author && <span>·</span>}
                  <Rate gap={1} size={10} value={displayRating} />
                  <span>{displayRating.toFixed(1)}</span>
                </Flexbox>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default RelatedSkillCard;
