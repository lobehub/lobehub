'use client';

import { type ModalInstance } from '@lobehub/ui';
import { ActionIcon, Block, createModal, Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { t } from 'i18next';
import { Eye, EyeOff } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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

const SectionRow = memo<{
  alwaysVisible?: boolean;
  icon?: any;
  isHidden: boolean;
  label: string;
  onToggle: () => void;
}>(({ label, icon, isHidden, alwaysVisible, onToggle }) => (
  <Block style={{ opacity: isHidden ? 0.5 : 1 }} variant={isHidden ? 'filled' : 'borderless'}>
    <Flexbox horizontal align={'center'} height={40} justify={'space-between'} paddingInline={8}>
      <Flexbox horizontal align={'center'} gap={8}>
        {icon && <Icon icon={icon} size={18} />}
        <Text>{label}</Text>
      </Flexbox>
      {!alwaysVisible && (
        <ActionIcon icon={isHidden ? EyeOff : Eye} size={'small'} onClick={onToggle} />
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
        return (
          <SectionRow
            icon={route?.icon}
            isHidden={hiddenSections.includes(item.key)}
            key={item.key}
            label={t(item.labelKey as any)}
            onToggle={() => toggleSection(item.key)}
          />
        );
      })}
      <Divider style={{ margin: '8px 0' }} />
      {sidebarSectionOrder.map((key) => {
        const item = SECTION_ITEMS.find((i) => i.key === key);
        if (!item) return null;

        return (
          <SectionRow
            alwaysVisible={item.alwaysVisible}
            isHidden={!item.alwaysVisible && hiddenSections.includes(key)}
            key={key}
            label={t(item.labelKey as any)}
            onToggle={() => toggleSection(key)}
          />
        );
      })}
      <Divider style={{ margin: '8px 0' }} />
      {BOTTOM_ITEMS.map((item) => {
        const route = item.routeId ? getRouteById(item.routeId) : undefined;
        const icon = route?.icon;
        return (
          <SectionRow
            icon={icon}
            isHidden={hiddenSections.includes(item.key)}
            key={item.key}
            label={t(item.labelKey as any)}
            onToggle={() => toggleSection(item.key)}
          />
        );
      })}
    </Flexbox>
  );
});

CustomizeSidebarContent.displayName = 'CustomizeSidebarContent';

export const openCustomizeSidebarModal = (): ModalInstance =>
  createModal({
    centered: true,
    children: <CustomizeSidebarContent />,
    destroyOnHidden: true,
    footer: null,
    title: t('navPanel.customizeSidebar', { ns: 'common' }),
    width: 360,
  });
