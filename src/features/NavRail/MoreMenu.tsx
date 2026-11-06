'use client';

import { type DropdownItem, DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Book, EllipsisIcon, Feather, FileClockIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHelpMenuBugReportItem } from '@/business/client/hooks/useHelpMenuBugReportItem';
import { openChangelogModal } from '@/components/ChangelogModal';
import { openFeedbackModal } from '@/components/FeedbackModal';
import { DOCUMENTS_REFER_URL } from '@/const/url';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useNavLayout } from '@/hooks/useNavLayout';

import { RAIL_ICON_SIZE, styles } from './style';

/** Routes that have no rail tab of their own (generation, memory, dashboards). */
const MORE_NAV_KEYS = ['dashboard', 'image', 'memory'];

/**
 * The rail replaces the sidebar footer under `im_layout`, so the Help entries
 * that used to live there (docs, report a bug, feedback, changelog) move to the
 * end of this menu — otherwise they would be unreachable from the rail layout.
 */
const MoreMenu = memo<{ active?: boolean }>(({ active }) => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const { topNavItems, bottomMenuItems } = useNavLayout();
  const bugReportItem = useHelpMenuBugReportItem();

  const items = useMemo<DropdownItem[]>(() => {
    const navItems: DropdownItem[] = [...topNavItems, ...bottomMenuItems]
      .filter((item) => !item.hidden && item.url && MORE_NAV_KEYS.includes(item.key))
      .map((item) => ({
        icon: <Icon icon={item.icon} />,
        key: item.key,
        label: item.title,
        onClick: () => navigate(item.url!),
      }));

    const helpItems: DropdownItem[] = [
      {
        icon: <Icon icon={Book} />,
        key: 'docs',
        label: (
          <a href={DOCUMENTS_REFER_URL} rel="noopener noreferrer" target="_blank">
            {t('userPanel.docs')}
          </a>
        ),
      },
      ...(bugReportItem ? [bugReportItem as DropdownItem] : []),
      {
        icon: <Icon icon={Feather} />,
        key: 'feedback',
        label: t('userPanel.feedback'),
        onClick: () => {
          openFeedbackModal();
        },
      },
      {
        icon: <Icon icon={FileClockIcon} />,
        key: 'changelog',
        label: t('changelog'),
        onClick: () => {
          openChangelogModal();
        },
      },
    ];

    if (navItems.length === 0) return helpItems;

    return [...navItems, { type: 'divider' as const }, ...helpItems];
  }, [bottomMenuItems, bugReportItem, navigate, t, topNavItems]);

  if (items.length === 0) return null;

  return (
    <DropdownMenu items={items} placement={'rightTop'}>
      <Tooltip placement={'right'} title={t('tab.more')}>
        <div
          aria-label={t('tab.more')}
          {...stylex.props(styles.item, active && styles.itemActive)}
          role={'button'}
        >
          <Icon icon={EllipsisIcon} size={RAIL_ICON_SIZE} />
        </div>
      </Tooltip>
    </DropdownMenu>
  );
});

MoreMenu.displayName = 'MoreMenu';

export default MoreMenu;
