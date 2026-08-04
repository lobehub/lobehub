'use client';

import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { FileTextIcon, LayoutGrid, TimerIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Layout, { type CustomizeModalTab } from './Layout';
import RecentsTab from './tabs/Recents';
import RightBarTab from './tabs/RightBar';
import TasksTab from './tabs/Tasks';
import { useHomeCustomization } from './useHomeCustomization';

interface CustomizeModalContentProps {
  initialTab?: string;
}

const CustomizeModalContent = memo<CustomizeModalContentProps>(({ initialTab }) => {
  const { t } = useTranslation('home');
  const [activeTab, setActiveTab] = useState(initialTab ?? 'rightBar');
  const {
    isWidgetHidden,
    recentsCount,
    reset,
    setRecentsCount,
    setTaskCount,
    showPortrait,
    taskCount,
    togglePortrait,
    toggleWidget,
  } = useHomeCustomization();

  const tabs: CustomizeModalTab[] = [
    { icon: LayoutGrid, key: 'rightBar', label: t('dashboard.customize.tab.rightBar') },
    { icon: FileTextIcon, key: 'recents', label: t('dashboard.customize.tab.recents') },
    { icon: TimerIcon, key: 'tasks', label: t('dashboard.customize.tab.tasks') },
  ];

  return (
    <Layout activeTab={activeTab} tabs={tabs} onReset={reset} onTabChange={setActiveTab}>
      {activeTab === 'rightBar' && (
        <RightBarTab
          isWidgetHidden={isWidgetHidden}
          showPortrait={showPortrait}
          togglePortrait={togglePortrait}
          toggleWidget={toggleWidget}
        />
      )}
      {activeTab === 'recents' && (
        <RecentsTab recentsCount={recentsCount} setRecentsCount={setRecentsCount} />
      )}
      {activeTab === 'tasks' && <TasksTab setTaskCount={setTaskCount} taskCount={taskCount} />}
    </Layout>
  );
});

export const openHomeCustomizeModal = (tab?: string): ModalInstance =>
  createModal({
    content: <CustomizeModalContent initialTab={tab} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0 },
    },
    title: null,
    width: 'min(92vw, 860px)',
  });
