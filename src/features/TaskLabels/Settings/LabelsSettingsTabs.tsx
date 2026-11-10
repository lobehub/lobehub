'use client';

import { Flexbox, Tabs } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AgentLabelsSettings from '@/features/WorkspaceSetting/Labels';

import TaskLabelsSettings from '.';

type LabelKind = 'agent' | 'task';

/**
 * The Labels settings page holds both registries — agent labels and task
 * labels — as tabs. `?kind=task` deep-links the task tab.
 */
const LabelsSettingsTabs = memo(() => {
  const { t } = useTranslation('setting');
  const [searchParams, setSearchParams] = useSearchParams();
  const kind: LabelKind = searchParams.get('kind') === 'task' ? 'task' : 'agent';

  return (
    <Flexbox gap={16}>
      <Tabs
        activeKey={kind}
        items={[
          { key: 'agent', label: t('taskLabels.tabs.agent') },
          { key: 'task', label: t('taskLabels.tabs.task') },
        ]}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams);
          if (key === 'task') next.set('kind', 'task');
          else next.delete('kind');
          setSearchParams(next, { replace: true });
        }}
      />
      {kind === 'task' ? <TaskLabelsSettings /> : <AgentLabelsSettings />}
    </Flexbox>
  );
});

LabelsSettingsTabs.displayName = 'LabelsSettingsTabs';

export default LabelsSettingsTabs;
