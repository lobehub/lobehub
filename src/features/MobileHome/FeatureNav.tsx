'use client';

import { Icon, ScrollShadow } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { useFeatureNavItems } from './useFeatureNavItems';

const styles = stylex.create({
  chip: {
    alignItems: 'center',
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':active': cssVar.colorFillSecondary },
    borderRadius: 999,
    color: cssVar.colorText,
    display: 'flex',
    fontSize: 13,
    gap: 6,
    height: 36,
    paddingInline: 12,
    transitionDuration: '150ms',
    transitionProperty: 'background-color',
    transitionTimingFunction: cssVar.motionEaseOut,
    whiteSpace: 'nowrap',
  },
  // The link is the 44px touch target; the pill inside stays light.
  link: {
    // Rounded so the keyboard focus ring follows the pill.
    borderRadius: 999,
    color: 'inherit',
    display: 'flex',
    flex: 'none',
    paddingBlock: 4,
  },
  row: {
    gap: 8,
    paddingBlock: 4,
    paddingInline: 12,
  },
});

/**
 * The desktop sidebar's destinations as one scrollable row of links above the
 * mobile agent list: findable from home without pushing the agent list — the
 * page's main job — below the fold.
 */
const FeatureNav = memo(() => {
  const { t } = useTranslation('common');
  const items = useFeatureNavItems();

  if (items.length === 0) return null;

  return (
    <nav aria-label={t('navPanel.shortcuts')}>
      <ScrollShadow
        hideScrollBar
        horizontal
        className={stylex.props(styles.row).className}
        orientation={'horizontal'}
        size={24}
      >
        {items.map((item) => (
          <WorkspaceLink
            className={stylex.props(styles.link).className}
            data-testid={`mobile-feature-nav-${item.key}`}
            key={item.key}
            to={item.url!}
          >
            <span {...stylex.props(styles.chip)}>
              <Icon icon={item.icon} size={16} />
              {item.title}
            </span>
          </WorkspaceLink>
        ))}
      </ScrollShadow>
    </nav>
  );
});

FeatureNav.displayName = 'MobileHomeFeatureNav';

export default FeatureNav;
