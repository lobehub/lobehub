'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo, type ReactElement, useMemo } from 'react';

import Recents from '@/routes/(main)/home/features/Recents';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Agent from './Agent';
import BottomMenu from './BottomMenu';
import { CustomizeSidebarModal } from './CustomizeSidebarModal';

export enum GroupKey {
  Agent = 'agent',
  Project = 'project',
  Recents = 'recents',
}

const sectionComponents: Record<string, (key: string) => ReactElement> = {
  [GroupKey.Agent]: (key) => <Agent itemKey={key} key={key} />,
  [GroupKey.Recents]: (key) => <Recents itemKey={key} key={key} />,
};

const Body = memo(() => {
  const sidebarSectionOrder = useGlobalStore(systemStatusSelectors.sidebarSectionOrder);
  const hiddenSections = useGlobalStore(systemStatusSelectors.hiddenSidebarSections);

  const sections = useMemo(
    () =>
      sidebarSectionOrder
        .filter((key) => key === GroupKey.Agent || !hiddenSections.includes(key))
        .map((key) => sectionComponents[key]?.(key))
        .filter(Boolean),
    [sidebarSectionOrder, hiddenSections],
  );

  return (
    <Flexbox flex={1} justify={'space-between'} paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Recents, GroupKey.Project, GroupKey.Agent]} gap={8}>
        {sections}
      </Accordion>
      <BottomMenu />
      <CustomizeSidebarModal />
    </Flexbox>
  );
});

export default Body;
