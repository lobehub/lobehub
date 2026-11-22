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
  /**
   * Where the back action sits. A panel whose header carries an entity switcher
   * that has to start on the same column as its rows' icons puts it `trailing`:
   * as a leading action it takes the row's icon column for itself and pushes
   * the switcher — and the whole header — one slot right of the list below.
   */
  backPlacement?: 'leading' | 'trailing';
  backTo?: string;
  breadcrumb?: BreadcrumbItem[];
  /**
   * Inline inset of the header content, in px. Panels that lay the header out on
   * their row grid pass what `resolveHeaderContentInset` derives, so the header
   * content starts on the column their rows do.
   */
  contentInset?: number;
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
    backPlacement = 'leading',
    contentInset = 6,
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
    const backButton = showBack ? (
      <BackButton escape={backEscape} size={headerActionSize} to={backTo} onClick={onBack} />
    ) : null;
    // A trailing back action leaves the leading slot to the panel's own content,
    // which is what lets a switcher start on the rows' icon column.
    const leadingBack = backPlacement === 'leading';
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
        {leadingBack && backButton}
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
        paddingInline={contentInset}
        style={{ paddingBlockStart: topInset }}
      >
        {leftContent}
        <Flexbox horizontal align={'center'} flex={'none'} gap={2} justify={'flex-end'}>
          {!leadingBack && backButton}
          {showTogglePanelButton && <ToggleLeftPanelButton />}
          {right}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default SideBarHeaderLayout;
