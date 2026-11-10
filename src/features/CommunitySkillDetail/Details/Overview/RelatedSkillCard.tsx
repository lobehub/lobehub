'use client';

import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback } from 'react';
import urlJoin from 'url-join';

import Rate from '@/components/RatingOverview/Rate';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { type DiscoverSkillItem } from '@/types/discover';

import { useDetailActionContext } from '../../DetailProvider';

const styles = stylex.create({
  card: {
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transform: { 'default': null, ':hover': 'translateY(-1px)', ':active': 'translateY(0)' },
    boxShadow: {
      'default': null,
      ':hover': `0 10px 28px color-mix(in srgb, ${cssVar.colorText} 8%, transparent)`,
    },
    transition: 'transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
  },
  meta: {
    overflow: 'hidden',
    minWidth: 0,
    fontSize: '13px',
    color: cssVar.colorTextDescription,
    whiteSpace: 'nowrap',
  },
  metaAuthor: {
    overflow: 'hidden',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaRating: { flex: 'none', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  name: { fontSize: '14px', fontWeight: 600, lineHeight: 1.3 },
});

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
        className={stylex.props(styles.card).className}
        paddingBlock={12}
        paddingInline={14}
        variant={'outlined'}
        onClick={handleClick}
      >
        <Flexbox horizontal align={'center'} gap={12}>
          <Avatar avatar={icon || name || identifier} size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
            <Text ellipsis className={stylex.props(styles.name).className}>
              {name || identifier}
            </Text>
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.meta).className}
              gap={4}
            >
              {author && <span {...stylex.props(styles.metaAuthor)}>{author}</span>}
              {displayRating && (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={stylex.props(styles.metaRating).className}
                  gap={3}
                >
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
