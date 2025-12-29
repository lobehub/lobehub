import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Link2 } from 'lucide-react';
import { type ReactNode, memo } from 'react';

import CateTag from '../CateTag';
import HashTags from '../HashTags';
import Time from '../Time';

const ACTION_CLASSNAME = 'memory-actions';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    transition: opacity 0.15s ease;
  `,
  timelineCard: css`
    position: relative;
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

interface TimeLineCardProps {
  actions?: ReactNode;
  cate?: string | null;
  children?: ReactNode;
  hashTags?: string[] | null;
  onClick?: () => void;
  title?: ReactNode;
  titleAddon?: ReactNode;
  capturedAt?: Date | number | string;
}

const TimeLineCard = memo<TimeLineCardProps>(
  ({ title, titleAddon, cate, children, actions, onClick, capturedAt, hashTags }) => {
    return (
      <Block
        className={styles.timelineCard}
        clickable
        gap={12}
        onClick={onClick}
        padding={16}
        variant={'borderless'}
      >
        {(title || titleAddon) && (
          <Flexbox
            align={'center'}
            gap={4}
            horizontal
            style={{
              overflow: 'hidden',
            }}
            width={'100%'}
            wrap={'wrap'}
          >
            {title && typeof title === 'string' ? (
              <Text as={'h2'} fontSize={16} style={{ lineHeight: 1.5, margin: 0 }} weight={500}>
                {title}
              </Text>
            ) : (
              title
            )}
            {typeof titleAddon === 'string' ? (
              <Tag icon={<Icon icon={Link2} />} variant="borderless">
                {titleAddon}
              </Tag>
            ) : (
              titleAddon
            )}
          </Flexbox>
        )}
        {typeof children === 'string' ? (
          <Text as={'p'} color={cssVar.colorTextSecondary} ellipsis={{ rows: 3 }}>
            {children}
          </Text>
        ) : (
          children
        )}
        <HashTags hashTags={hashTags} />
        <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
          <Flexbox align={'center'} gap={8} horizontal>
            <CateTag cate={cate} />
            <Time capturedAt={capturedAt} />
          </Flexbox>
          <Flexbox
            align={'center'}
            className={cx(ACTION_CLASSNAME, styles.actions)}
            gap={4}
            horizontal
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

export default TimeLineCard;
