'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { Link as RouterLink } from 'react-router-dom';

const styles = createStaticStyles(({ css, cssVar }) => ({
  more: css`
    display: flex;
    align-items: center;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    margin-block: 0.2em;
    font-weight: bold;
    line-height: 1.5;
  `,
  title2: css`
    font-size: 18px;
  `,
  title3: css`
    font-size: 16px;
  `,
}));

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
      <h2 className={cx(styles.title, styles[`title${level}` as 'title2' | 'title3'])} id={id}>
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
          <a className={styles.more} href={moreLink} rel="noreferrer" target="_blank">
            <span style={{ marginRight: 4 }}>{more}</span>
            <Icon icon={ChevronRight} />
          </a>
        );
      } else if (isCommunityRoute) {
        moreLinkElement = (
          <RouterLink className={styles.more} to={moreLink}>
            <span style={{ marginRight: 4 }}>{more}</span>
            <Icon icon={ChevronRight} />
          </RouterLink>
        );
      } else {
        // For non-external, non-community routes (like auth pages), use RouterLink
        moreLinkElement = (
          <RouterLink className={styles.more} to={moreLink}>
            <span style={{ marginRight: 4 }}>{more}</span>
            <Icon icon={ChevronRight} />
          </RouterLink>
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
