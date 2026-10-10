'use client';

import { createStaticStyles, Flexbox, Icon } from '@lobehub/ui';
import { Breadcrumb, type BreadcrumbItem, Text } from '@lobehub/ui';
import { ChevronRightIcon, HomeIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { flushSync } from 'react-dom';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isModifierClick } from '@/utils/navigation';

import BackButton from './components/BackButton';
import ToggleLeftPanelButton from './ToggleLeftPanelButton';

const styles = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    li,
    li[aria-current='page'] {
      font-size: 12px;
      font-weight: normal;
      color: ${cssVar.colorTextDescription};
    }

    a:hover {
      color: ${cssVar.colorText};
    }
  `,
  container: css`
    overflow: hidden;
  `,
}));

interface SideBarHeaderLayoutProps {
  backTo?: string;
  breadcrumb?: BreadcrumbItem[];
  /** Override the leading home breadcrumb item (defaults to home icon → `/`). */
  homeItem?: BreadcrumbItem;
  left?: ReactNode;
  right?: ReactNode;
  showBack?: boolean;
  showTogglePanelButton?: boolean;
}

const SideBarHeaderLayout = memo<SideBarHeaderLayoutProps>(
  ({
    left,
    right,
    backTo = '/',
    showBack = true,
    breadcrumb = [],
    homeItem,
    showTogglePanelButton = true,
  }) => {
    const navigate = useWorkspaceAwareNavigate();
    const leftContent = left ? (
      <Flexbox
        horizontal
        align={'center'}
        flex={1}
        gap={2}
        style={{
          overflow: 'hidden',
        }}
      >
        {showBack && <BackButton size={DESKTOP_HEADER_ICON_SMALL_SIZE} to={backTo} />}
        {left && typeof left === 'string' ? (
          <Text ellipsis fontSize={16} weight={500}>
            {left}
          </Text>
        ) : (
          left
        )}
      </Flexbox>
    ) : (
      <Flexbox flex={1} paddingInline={6}>
        <Breadcrumb
          className={styles.breadcrumb}
          separator={<Icon icon={ChevronRightIcon} />}
          items={[
            homeItem ?? {
              href: '/',
              title: <Icon icon={HomeIcon} />,
            },
            ...breadcrumb,
          ].map((item) => ({
            ...item,
            onClick: (event) => {
              if (isModifierClick(event)) return;
              const href = item.href;
              if (href) {
                event.preventDefault();
                event.stopPropagation();
                // eslint-disable-next-line @eslint-react/dom/no-flush-sync
                flushSync(() => navigate(href));
              }
            },
          }))}
        />
      </Flexbox>
    );

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.container}
        flex={'none'}
        justify={'space-between'}
        padding={'8px 6px'}
      >
        {leftContent}
        <Flexbox horizontal align={'center'} gap={2} justify={'flex-end'}>
          {showTogglePanelButton && <ToggleLeftPanelButton />}
          {right}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default SideBarHeaderLayout;
