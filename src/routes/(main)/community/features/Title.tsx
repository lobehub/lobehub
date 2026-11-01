'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  more: { display: 'flex', alignItems: 'center', color: cssVar.colorTextSecondary },
  title: { marginBlock: '0.2em', fontWeight: 'bold', lineHeight: 1.5 },
  title2: { fontSize: '18px' },
  title3: { fontSize: '16px' },
});

export interface TitleProps extends FlexboxProps {
  icon?: ReactNode;
  id?: string;
  level?: 2 | 3;
  more?: ReactNode;
  moreLink?: string;
  tag?: ReactNode;
}

const Title = memo<TitleProps>(
  ({ id, tag, children, moreLink, more, level = 2, icon, ...rest }) => {
    const title = (
      <h2 {...stylex.props(styles.title, level === 3 ? styles.title3 : styles.title2)} id={id}>
        {children}
      </h2>
    );

    // Check if it's an external link or internal community route
    const isExternalLink = moreLink?.startsWith('http') ?? false;
    const isCommunityRoute = moreLink?.startsWith('/community') ?? false;

    let moreLinkElement = null;
    if (moreLink) {
      if (isExternalLink) {
        moreLinkElement = (
          <a {...stylex.props(styles.more)} href={moreLink} rel="noreferrer" target="_blank">
            <span style={{ marginRight: 4 }}>{more}</span>
            <Icon icon={ChevronRight} />
          </a>
        );
      } else if (isCommunityRoute) {
        moreLinkElement = (
          <WorkspaceLink className={stylex.props(styles.more).className} to={moreLink}>
            <span style={{ marginRight: 4 }}>{more}</span>
            <Icon icon={ChevronRight} />
          </WorkspaceLink>
        );
      } else {
        moreLinkElement = (
          <WorkspaceLink className={stylex.props(styles.more).className} to={moreLink}>
            <span style={{ marginRight: 4 }}>{more}</span>
            <Icon icon={ChevronRight} />
          </WorkspaceLink>
        );
      }
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={16}
        justify={'space-between'}
        width={'100%'}
        {...rest}
      >
        {tag || icon ? (
          <Flexbox horizontal align={'center'} gap={8}>
            {icon}
            {title}
            {tag && (
              <Flexbox horizontal align={'center'} gap={4}>
                {tag}
              </Flexbox>
            )}
          </Flexbox>
        ) : (
          title
        )}
        {moreLinkElement}
      </Flexbox>
    );
  },
);

export default Title;
