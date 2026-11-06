'use client';

import {
  Breadcrumb,
  type BreadcrumbItem,
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- Breadcrumb links take no className
  createStaticStyles,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon, HomeIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { flushSync } from 'react-dom';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { isModifierClick } from '@/utils/navigation';

import BackButton from './components/BackButton';
import ToggleLeftPanelButton from './ToggleLeftPanelButton';

const containerStyles = stylex.create({
  breadcrumbItem: {
    color: cssVar.colorTextDescription,
    fontSize: '12px',
    fontWeight: 'normal',
  },
  container: { overflow: 'hidden' },
});

const breadcrumbClassNames = { item: stylex.props(containerStyles.breadcrumbItem).className };

const fallback = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    a:hover {
      color: ${cssVar.colorText};
    }
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
          className={fallback.breadcrumb}
          classNames={breadcrumbClassNames}
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
                // eslint-disable-next-line @eslint-react/dom-no-flush-sync
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
        className={stylex.props(containerStyles.container).className}
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
