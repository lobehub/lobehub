'use client';

import { ActionIcon, Block, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { Eye, EyeOff, PinIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

import { getRouteById } from '@/config/routes';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

// Top nav items (Pages)
const TOP_NAV_ITEMS: { key: string; labelKey: string; routeId?: string }[] = [
  { key: 'pages', labelKey: 'tab.pages', routeId: 'page' },
];

// Accordion sections (Recents, Agents)
// `alwaysVisible` sections cannot be hidden by the user
const SECTION_ITEMS: { alwaysVisible?: boolean; icon?: any; key: string; labelKey: string }[] = [
  { key: 'recents', labelKey: 'recents' },
  { alwaysVisible: true, key: 'agent', labelKey: 'navPanel.agent' },
];

// Bottom menu items (Community, Resources)
const BOTTOM_ITEMS: { key: string; labelKey: string; routeId?: string }[] = [
  { key: 'community', labelKey: 'tab.community', routeId: 'community' },
  { key: 'resource', labelKey: 'tab.resource', routeId: 'resource' },
];

const useCustomizeSidebarModalStore = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export const openCustomizeSidebarModal = () =>
  useCustomizeSidebarModalStore.getState().setOpen(true);

const SectionRow = memo<{
  alwaysVisible?: boolean;
  icon?: any;
  isHidden: boolean;
  label: string;
  pinnedTooltip?: string;
  toggleTooltip?: string;
  onToggle: () => void;
}>(({ label, icon, isHidden, alwaysVisible, pinnedTooltip, toggleTooltip, onToggle }) => (
  <Block style={{ opacity: isHidden ? 0.5 : 1 }} variant={isHidden ? 'filled' : 'borderless'}>
    <Flexbox horizontal align={'center'} height={40} justify={'space-between'} paddingInline={8}>
      <Flexbox horizontal align={'center'} gap={8}>
        {icon && <Icon icon={icon} size={18} />}
        <Text>{label}</Text>
      </Flexbox>
      {alwaysVisible ? (
        <Tooltip title={pinnedTooltip}>
          <ActionIcon icon={PinIcon} size={'small'} style={{ cursor: 'default', opacity: 0.45 }} />
        </Tooltip>
      ) : (
        <Tooltip title={toggleTooltip}>
          <ActionIcon icon={isHidden ? EyeOff : Eye} size={'small'} onClick={onToggle} />
        </Tooltip>
      )}
    </Flexbox>
  </Block>
));

const CustomizeSidebarContent = memo(() => {
  const { t } = useTranslation('common');

  const [sidebarSectionOrder, hiddenSections, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.sidebarSectionOrder(s),
    systemStatusSelectors.hiddenSidebarSections(s),
    s.updateSystemStatus,
  ]);

  const toggleSection = (sectionKey: string) => {
    const isHidden = hiddenSections.includes(sectionKey);
    const newHidden = isHidden
      ? hiddenSections.filter((k) => k !== sectionKey)
      : [...hiddenSections, sectionKey];
    updateSystemStatus({ hiddenSidebarSections: newHidden });
  };

  return (
    <Flexbox gap={2}>
      {TOP_NAV_ITEMS.map((item) => {
        const route = item.routeId ? getRouteById(item.routeId) : undefined;
        const isHidden = hiddenSections.includes(item.key);
        return (
          <SectionRow
            icon={route?.icon}
            isHidden={isHidden}
            key={item.key}
            label={t(item.labelKey as any)}
            toggleTooltip={t(isHidden ? ('navPanel.hidden' as any) : ('navPanel.visible' as any))}
            onToggle={() => toggleSection(item.key)}
          />
        );
      })}
      <Divider style={{ margin: '8px 0' }} />
      {sidebarSectionOrder.map((key) => {
        const item = SECTION_ITEMS.find((i) => i.key === key);
        if (!item) return null;
        const isHidden = !item.alwaysVisible && hiddenSections.includes(key);

        return (
          <SectionRow
            alwaysVisible={item.alwaysVisible}
            isHidden={isHidden}
            key={key}
            label={t(item.labelKey as any)}
            pinnedTooltip={t('navPanel.pinned' as any)}
            toggleTooltip={t(isHidden ? ('navPanel.hidden' as any) : ('navPanel.visible' as any))}
            onToggle={() => toggleSection(key)}
          />
        );
      })}
      <Divider style={{ margin: '8px 0' }} />
      {BOTTOM_ITEMS.map((item) => {
        const route = item.routeId ? getRouteById(item.routeId) : undefined;
        const icon = route?.icon;
        const isHidden = hiddenSections.includes(item.key);
        return (
          <SectionRow
            icon={icon}
            isHidden={isHidden}
            key={item.key}
            label={t(item.labelKey as any)}
            toggleTooltip={t(isHidden ? ('navPanel.hidden' as any) : ('navPanel.visible' as any))}
            onToggle={() => toggleSection(item.key)}
          />
        );
      })}
    </Flexbox>
  );
});

export const CustomizeSidebarModal = memo(() => {
  const { t } = useTranslation('common');
  const open = useCustomizeSidebarModalStore((s) => s.open);
  const setOpen = useCustomizeSidebarModalStore((s) => s.setOpen);

  return (
    <Modal
      centered
      destroyOnHidden
      footer={null}
      open={open}
      title={t('navPanel.customizeSidebar')}
      width={360}
      onCancel={() => setOpen(false)}
    >
      <CustomizeSidebarContent />
    </Modal>
  );
});
