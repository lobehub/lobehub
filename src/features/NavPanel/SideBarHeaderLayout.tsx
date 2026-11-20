'use client';

import {
  Breadcrumb,
  type BreadcrumbItem,
  createStaticStyles,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { ChevronRightIcon, HomeIcon } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { memo } from 'react';
import { flushSync } from 'react-dom';

import { getContainerTopInset } from '@/features/DesktopLayoutContainer/cssVariables';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDensityTokens, useHeaderActionSize } from '@/styles/density';
import { isModifierClick } from '@/utils/navigation';

import BackButton from './components/BackButton';
import { useNavItemMetrics } from './density';
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
  /** `backTo` is a literal path that already carries its workspace scope. */
  backEscape?: boolean;
  backTo?: string;
  breadcrumb?: BreadcrumbItem[];
  /** Override the leading home breadcrumb item (defaults to home icon → `/`). */
  homeItem?: BreadcrumbItem;
  left?: ReactNode;
  /** Runs before the back navigation; `preventDefault()` cancels it. */
  onBack?: (event: MouseEvent) => void;
  right?: ReactNode;
  showBack?: boolean;
  showTogglePanelButton?: boolean;
}

const SideBarHeaderLayout = memo<SideBarHeaderLayoutProps>(
  ({
    left,
    right,
    backTo = '/',
    backEscape,
    onBack,
    showBack = true,
    breadcrumb = [],
    homeItem,
    showTogglePanelButton = true,
  }) => {
    const navigate = useWorkspaceAwareNavigate();
    const { headerTitleFontSize, headerTitleWeight } = useNavItemMetrics();
    const { headerHeight } = useDensityTokens();
    const topInset = getContainerTopInset();
    const headerActionSize = useHeaderActionSize(true);
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
        {showBack && (
          <BackButton escape={backEscape} size={headerActionSize} to={backTo} onClick={onBack} />
        )}
        {left && typeof left === 'string' ? (
          <Text ellipsis fontSize={headerTitleFontSize} weight={headerTitleWeight}>
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
        className={styles.container}
        flex={'none'}
        height={headerHeight + topInset}
        justify={'space-between'}
        paddingInline={6}
        style={{ paddingBlockStart: topInset }}
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
