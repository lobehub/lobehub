import { type MenuProps } from '@lobehub/ui';
import {
  AccordionItem,
  ActionIcon,
  ContextMenuTrigger,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeOffIcon,
  Hash,
  LucideCheck,
  MoreHorizontalIcon,
  SlidersHorizontalIcon,
} from 'lucide-react';
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useInitRecents } from '@/hooks/useInitRecents';
import { openCustomizeSidebarModal } from '@/routes/(main)/home/_layout/Body/CustomizeSidebarModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { reorderSidebarItems } from '@/store/global/selectors/systemStatus';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import RecentsList from './List';

interface RecentsProps {
  itemKey: string;
}

const Recents = memo<RecentsProps>(({ itemKey }) => {
  const { t } = useTranslation('common');
  const recents = useHomeStore(homeRecentSelectors.recents);
  const isInit = useHomeStore(homeRecentSelectors.isRecentsInit);
  const isLogin = useUserStore(authSelectors.isLogin);
  const { isRevalidating } = useInitRecents();

  const [recentPageSize, sidebarItems, hiddenSections, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.recentPageSize(s),
    systemStatusSelectors.sidebarItems(s),
    systemStatusSelectors.hiddenSidebarSections(s),
    s.updateSystemStatus,
  ]);

  const visibleItems = sidebarItems.filter((k) => !hiddenSections.includes(k));
  const visibleIndex = visibleItems.indexOf('recents');
  const isFirst = visibleIndex === 0;
  const isLast = visibleIndex === visibleItems.length - 1;

  const moveSection = useCallback(
    (direction: 'up' | 'down') => {
      const idx = sidebarItems.indexOf('recents');
      if (idx === -1) return;
      const next = reorderSidebarItems(sidebarItems, idx, direction === 'up' ? idx - 1 : idx + 1);
      if (next === sidebarItems) return;
      updateSystemStatus({ sidebarItems: next });
    },
    [sidebarItems, updateSystemStatus],
  );

  const hideSection = useCallback(() => {
    updateSystemStatus({ hiddenSidebarSections: [...hiddenSections, 'recents'] });
  }, [hiddenSections, updateSystemStatus]);

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
      {
        disabled: isFirst,
        icon: <Icon icon={ArrowUpIcon} />,
        key: 'moveUp',
        label: t('navPanel.moveUp'),
        onClick: () => moveSection('up'),
      },
      {
        disabled: isLast,
        icon: <Icon icon={ArrowDownIcon} />,
        key: 'moveDown',
        label: t('navPanel.moveDown'),
        onClick: () => moveSection('down'),
      },
      {
        disabled: false,
        icon: <Icon icon={EyeOffIcon} />,
        key: 'hideSection',
        label: t('navPanel.hideSection'),
        onClick: hideSection,
      },
      { type: 'divider' as const },
      {
        icon: <Icon icon={SlidersHorizontalIcon} />,
        key: 'customizeSidebar',
        label: t('navPanel.customizeSidebar'),
        onClick: () => openCustomizeSidebarModal(),
      },
    ] as MenuProps['items'];
  }, [
    recentPageSize,
    updateSystemStatus,
    t,
    isFirst,
    isLast,
    moveSection,
    hideSection,
    visibleItems.length,
  ]);

  if (!isLogin) return null;
  if (isInit && (!recents || recents.length === 0)) return null;

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      action={
        <DropdownMenu items={dropdownMenu} nativeButton={false}>
          <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
        </DropdownMenu>
      }
      headerWrapper={(header) => (
        <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
      )}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('recents')}
          </Text>
          {isRevalidating && <NeuralNetworkLoading size={14} />}
        </Flexbox>
      }
    >
      <Suspense fallback={<SkeletonList rows={3} />}>
        <RecentsList />
      </Suspense>
    </AccordionItem>
  );
});

export default Recents;
