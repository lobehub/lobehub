import { Block, Center, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

import HashTags from '../HashTags';
import Time from '../Time';
import { useCateColor } from '../useCateColor';

const ACTION_CLASSNAME = 'memory-masonry-actions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    transition: opacity 0.15s ease;
  `,
  masonryCard: css`
    cursor: pointer;
    position: relative;
    background: ${cssVar.colorFillQuaternary};
    box-shadow: 0 0 0 1px ${cssVar.colorFillTertiary} inset;
    .${ACTION_CLASSNAME} {
      opacity: 0;
    }

    &:hover {
      .${ACTION_CLASSNAME} {
        opacity: 1;
      }
    }
  `,
}));

interface GridCardProps {
  actions?: ReactNode;
  badges?: ReactNode;
  capturedAt?: Date | number | string;
  cate?: string | null;
  children?: ReactNode;
  footer?: ReactNode;
  hashTags?: string[] | null;
  onClick?: () => void;
  title?: ReactNode;
  titleAddon?: ReactNode;
}

const GridCard = memo<GridCardProps>(
  ({
    title,
    titleAddon,
    cate,
    children,
    actions,
    onClick,
    hashTags,
    badges,
    footer,
    capturedAt,
  }) => {
    const cateColor = useCateColor(cate);
    return (
      <Block
        className={styles.masonryCard}
        gap={4}
        height={'100%'}
        padding={4}
        variant={'filled'}
        style={{
          background: cateColor?.backgroundColor,
        }}
        onClick={onClick}
      >
        <Block
          flex={1}
          gap={12}
          paddingBlock={16}
          paddingInline={12}
          variant={'outlined'}
          style={{
            boxShadow: `0 4px 16px -4px ${cateColor?.shadowColor || 'rgba(0, 0, 0, 0.2)'}`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {(title || titleAddon) && (
            <>
              <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                {title && typeof title === 'string' ? (
                  <Text
                    as={'h2'}
                    ellipsis={{ rows: 2 }}
                    fontSize={16}
                    style={{ lineHeight: 1.5, margin: 0 }}
                    weight={500}
                  >
                    {title}
                  </Text>
                ) : (
                  title
                )}
              </Flexbox>
              {typeof titleAddon === 'string' ? (
                <Tag variant="borderless">{titleAddon}</Tag>
              ) : (
                titleAddon
              )}
            </>
          )}
          {typeof children === 'string' ? (
            <Text as={'p'} color={cssVar.colorTextSecondary} ellipsis={{ rows: 4 }}>
              {children}
            </Text>
          ) : (
            children
          )}
          <HashTags hashTags={hashTags} />
          <Flexbox
            horizontal
            align={'center'}
            gap={12}
            justify={'space-between'}
            style={{
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {footer}
            <Time capturedAt={capturedAt} />
          </Flexbox>
        </Block>
        <Flexbox
          horizontal
          align={'center'}
          justify={'space-between'}
          paddingBlock={8}
          paddingInline={8}
          style={{ overflow: 'hidden', position: 'relative' }}
          width={'100%'}
        >
          <Flexbox
            horizontal
            align={'center'}
            flex={1}
            gap={8}
            style={{
              overflow: 'hidden',
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            {badges}
          </Flexbox>
          <Center flex={'none'}>
            <Text
              align={'center'}
              color={cateColor?.backgroundTextColor || cssVar.colorTextSecondary}
              weight={'bold'}
              style={{
                opacity: 0.5,
              }}
            >
              {cate?.toUpperCase() || 'CHORE'}
            </Text>
          </Center>
          <Flexbox
            horizontal
            align={'center'}
            className={cx(ACTION_CLASSNAME, styles.actions)}
            flex={1}
            gap={4}
            justify={'flex-end'}
            style={{
              overflow: 'hidden',
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            {actions}
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default GridCard;
