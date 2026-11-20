import { type DropdownItem } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  ContextMenuTrigger,
  cx,
  DropdownMenu,
  Flexbox,
  Icon,
  Spin,
} from '@lobehub/ui';
import { Hash, LucideCheck, MoreHorizontalIcon } from 'lucide-react';
import { memo, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSidebarSectionMenuItems } from '@/features/HomeSidebar/Body/useSidebarSectionMenuItems';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';
import { createRecentQueryKey } from '@/store/home/slices/recent/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import RecentsList from './List';

interface RecentsProps {
  itemKey: string;
}

const Recents = memo<RecentsProps>(({ itemKey }) => {
  const { t } = useTranslation('common');
  const sectionTriggerStyle = useSectionTriggerStyle();
  const isLogin = useUserStore(authSelectors.isLogin);
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);
  const queryKey = createRecentQueryKey(recentPageSize + 1);
  const items = useHomeStore(homeRecentSelectors.query(queryKey));
  const useFetchRecents = useHomeStore((s) => s.useFetchRecents);
  const syncStatus = useFetchRecents(isLogin, recentPageSize);
  const refreshRecents = useHomeStore((s) => s.refreshRecents);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const sectionMenuItems = useSidebarSectionMenuItems(itemKey);

  const dropdownMenu = useMemo(() => {
    const pageSizeOptions = [5, 10, 15, 20];
    const pageSizeItems = pageSizeOptions.map((size) => ({
      icon: recentPageSize === size ? <Icon icon={LucideCheck} /> : <div />,
      key: `pageSize-${size}`,
      label: t('pageSizeItem', { count: size }),
      onClick: () => {
        updateSystemStatus({ recentPageSize: size });
      },
    }));

    return [
      {
        children: pageSizeItems,
        extra: recentPageSize,
        icon: <Icon icon={Hash} />,
        key: 'show',
        label: t('navPanel.show'),
      },
      ...sectionMenuItems,
    ] as DropdownItem[];
  }, [recentPageSize, updateSystemStatus, t, sectionMenuItems]);

  if (!isLogin) return null;
  if (items && items.length === 0) return null;

  return (
    <AccordionItem value={itemKey}>
      <ContextMenuTrigger items={dropdownMenu}>
        <AccordionHeader>
          <AccordionTrigger style={sectionTriggerStyle}>
            <Flexbox horizontal align="center" gap={4}>
              <SectionTitle>{t('recents')}</SectionTitle>
              {syncStatus.isValidating && items && <Spin size="small" variant="network" />}
            </Flexbox>
          </AccordionTrigger>
          <div
            className={cx(
              'accordion-action',
              accordionStyles.action,
              accordionStyles.actionBorderless,
            )}
          >
            <DropdownMenu items={dropdownMenu}>
              <ActionIcon
                aria-label={t('more')}
                icon={MoreHorizontalIcon}
                size={'small'}
                style={{ flex: 'none' }}
                title={t('more')}
              />
            </DropdownMenu>
          </div>
        </AccordionHeader>
      </ContextMenuTrigger>
      <AccordionPanel>
        <Suspense fallback={<SkeletonList rows={3} />}>
          <RecentsList error={syncStatus.error} onRetry={() => void refreshRecents()} />
        </Suspense>
      </AccordionPanel>
    </AccordionItem>
  );
});

export default Recents;
