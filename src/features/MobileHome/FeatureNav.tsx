'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useFeatureNavItems } from './useFeatureNavItems';

const styles = stylex.create({
  grid: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    paddingBlockStart: '8px',
    paddingBlockEnd: '4px',
    paddingInline: 8,
  },
  item: {
    backgroundColor: { 'default': 'transparent', ':active': cssVar.colorFillTertiary },
    borderRadius: cssVar.borderRadiusLG,
    cursor: 'pointer',
    paddingBlockStart: '10px',
    paddingBlockEnd: '8px',
    paddingInline: 4,
    transitionDuration: '150ms',
    transitionProperty: 'background-color',
    transitionTimingFunction: cssVar.motionEaseOut,
  },
  label: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/** The desktop sidebar's destinations as shortcuts above the mobile agent list. */
const FeatureNav = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const items = useFeatureNavItems();

  if (items.length === 0) return null;

  return (
    <nav aria-label={t('tab.home')} {...stylex.props(styles.grid)}>
      {items.map((item) => (
        <Flexbox
          align={'center'}
          className={stylex.props(styles.item).className}
          data-testid={`mobile-feature-nav-${item.key}`}
          gap={6}
          key={item.key}
          role={'link'}
          onClick={() => navigate(item.url!)}
        >
          <Icon icon={item.icon} size={22} />
          <Text className={stylex.props(styles.label).className}>{item.title}</Text>
        </Flexbox>
      ))}
    </nav>
  );
});

FeatureNav.displayName = 'MobileHomeFeatureNav';

export default FeatureNav;
