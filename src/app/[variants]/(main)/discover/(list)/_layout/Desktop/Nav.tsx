'use client';

import { Tabs } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { rgba } from 'polished';
import { memo, useState } from 'react';
import { Center, Flexbox } from 'react-layout-kit';
import { useLocation, useNavigate } from 'react-router-dom';

import { withSuspense } from '@/components/withSuspense';
import { useQuery } from '@/hooks/useQuery';
import { DiscoverTab } from '@/types/discover';

import { MAX_WIDTH, SCROLL_PARENT_ID } from '../../../features/const';
import { useNav } from '../../../features/useNav';
import SortButton from '../../features/SortButton';
import { useScroll } from './useScroll';

export const useStyles = createStyles(({ cx, stylish, css, token }) => ({
  container: cx(
    stylish.blur,
    css`
      position: absolute;
      z-index: 9;
      inset-block-start: 52px;
      inset-inline: 0 0;

      padding-block: 4px;
      border-block-end: 1px solid ${token.colorBorderSecondary};

      background: ${rgba(token.colorBgContainerSecondary, 0.9)};

      transition: all 0.3s ${token.motionEaseInOut};
    `,
  ),
  hide: css`
    transform: translateY(-150%);
  `,
}));

const Nav = memo(() => {
  const [hide, setHide] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { cx, styles } = useStyles();
  const { items, activeKey } = useNav();
  const { q } = useQuery() as { q?: string };

  useScroll((scroll, delta) => {
    if (delta < 0) {
      setHide(false);
      return;
    }
    if (scroll > 600 && delta > 0) {
      setHide(true);
    }
  });

  const isHome = location.pathname === '/';

  return (
    <Center className={cx(styles.container, hide && styles.hide)} height={46}>
      <Flexbox
        align={'center'}
        horizontal
        justify={'space-between'}
        style={{
          maxWidth: MAX_WIDTH,
          width: '100%',
        }}
      >
        <Flexbox align={'center'} gap={4} horizontal>
          <Tabs
            activeKey={activeKey}
            compact
            items={items as any}
            onChange={(key) => {
              const path = key === DiscoverTab.Home ? '/' : `/${key}`;
              const search = q ? `?q=${encodeURIComponent(q)}` : '';
              navigate(path + search, { replace: true });
              const scrollableElement = document?.querySelector(`#${SCROLL_PARENT_ID}`);
              if (!scrollableElement) return;
              scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
            }}
            style={{
              fontWeight: 500,
            }}
          />
        </Flexbox>
        {!isHome && (
          <Flexbox align={'center'} gap={4} horizontal>
            <SortButton />
          </Flexbox>
        )}
      </Flexbox>
    </Center>
  );
});

export default withSuspense(Nav);
