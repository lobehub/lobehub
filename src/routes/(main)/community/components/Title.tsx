'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Button, Flexbox, Icon, Tag, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { SCROLL_PARENT_ID } from '../features/const';

const SCROLL_CONTAINER_ID = 'lobe-mobile-scroll-container';

const styles = stylex.create({
  more: { display: 'flex', alignItems: 'center', color: cssVar.colorTextSecondary },
  tag: {
    flex: 'none',
    paddingBlock: '0.1em',
    paddingInline: '0.3em',
    borderRadius: cssVar.borderRadius,
    fontSize: { default: '18px', [media.sm]: '14px' },
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  title: {
    marginBlockStart: '0.5em',
    fontSize: { default: '20px', [media.sm]: '18px' },
    fontWeight: 600,
  },
});

interface TitleProps extends FlexboxProps {
  more?: ReactNode;
  moreLink?: string;
  tag?: ReactNode;
}

const Title = memo<TitleProps>(({ tag, children, moreLink, more }) => {
  const { mobile } = useResponsive();
  const title = <h2 {...stylex.props(styles.title)}>{children}</h2>;

  const handleMoreClick = () => {
    if (!moreLink) return;

    const scrollContainerId = mobile ? SCROLL_CONTAINER_ID : SCROLL_PARENT_ID;
    const scrollableElement = document?.querySelector(`#${scrollContainerId}`);

    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };

  return (
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} width={'100%'}>
      {tag ? (
        <Flexbox horizontal align={'center'} gap={8}>
          {title}
          <Tag className={stylex.props(styles.tag).className}>{tag}</Tag>
        </Flexbox>
      ) : (
        title
      )}
      {moreLink && (
        <WorkspaceLink
          target={moreLink.startsWith('http') ? '_blank' : undefined}
          to={moreLink}
          onClick={handleMoreClick}
        >
          <Button
            className={stylex.props(styles.more).className}
            style={{ paddingInline: 6 }}
            type={'text'}
          >
            <span>{more}</span>
            <Icon icon={ChevronRight} />
          </Button>
        </WorkspaceLink>
      )}
    </Flexbox>
  );
});

export default Title;
