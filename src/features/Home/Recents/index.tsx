import { type MenuProps } from '@lobehub/ui';
import { ContextMenuTrigger, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Spin,
  Text,
} from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeOffIcon,
  Hash,
  ListFilter,
  LucideCheck,
  MoreHorizontalIcon,
  SlidersHorizontalIcon,
} from 'lucide-react';
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openCustomizeSidebarModal } from '@/features/HomeSidebar/Body/CustomizeSidebarModal';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { type RecentSidebarType } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { reorderSidebarItems } from '@/store/global/selectors/systemStatus';
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
  const isLogin = useUserStore(authSelectors.isLogin);
  const activeWorkspaceId = useActiveWorkspaceId();
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);
  const recentSidebarTypes = useGlobalStore(systemStatusSelectors.recentSidebarTypes);
  const queryKey = createRecentQueryKey(recentPageSize + 1);
  const items = useHomeStore(homeRecentSelectors.query(queryKey));
  const useFetchRecents = useHomeStore((s) => s.useFetchRecents);
  const syncStatus = useFetchRecents(isLogin, recentPageSize, recentSidebarTypes);
  const refreshRecents = useHomeStore((s) => s.refreshRecents);
  const sidebarItems = useGlobalStore(systemStatusSelectors.sidebarItems(activeWorkspaceId));
  const hiddenSections = useGlobalStore(
    systemStatusSelectors.hiddenSidebarSections(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

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

  const toggleRecentType = useCallback(
    (type: RecentSidebarType) => {
      const next = recentSidebarTypes.includes(type)
        ? recentSidebarTypes.filter((item) => item !== type)
        : [...recentSidebarTypes, type];
      // An empty filter would list nothing at all — hiding the section is what
      // "Hide Section" is for, so the last checked type stays checked.
      if (next.length === 0) return;
      updateSystemStatus({ recentSidebarTypes: next });
    },
    [recentSidebarTypes, updateSystemStatus],
  );

  const dropdownMenu = useMemo(() => {
    const typeOptions: { label: string; type: RecentSidebarType }[] = [
      { label: t('navPanel.recentType.topic'), type: 'topic' },
      { label: t('navPanel.recentType.document'), type: 'document' },
      { label: t('navPanel.recentType.task'), type: 'task' },
    ];
    const typeItems = typeOptions.map(({ label, type }) => ({
      icon: recentSidebarTypes.includes(type) ? <Icon icon={LucideCheck} /> : <div />,
      key: `type-${type}`,
      label,
      onClick: () => toggleRecentType(type),
    }));

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
        children: typeItems,
        icon: <Icon icon={ListFilter} />,
        key: 'filter',
        label: t('navPanel.filter'),
      },
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
    recentSidebarTypes,
    toggleRecentType,
    updateSystemStatus,
    t,
    isFirst,
    isLast,
    moveSection,
    hideSection,
  ]);

  if (!isLogin) return null;
  if (items && items.length === 0) return null;

  return (
    <AccordionItem value={itemKey}>
      <ContextMenuTrigger items={dropdownMenu}>
        <AccordionHeader>
          <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
            <Flexbox horizontal align="center" gap={4}>
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('recents')}
              </Text>
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
              <ActionIcon icon={MoreHorizontalIcon} size={'small'} style={{ flex: 'none' }} />
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
