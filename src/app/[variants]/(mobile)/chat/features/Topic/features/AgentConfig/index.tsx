'use client';

import { ActionIcon } from '@lobehub/ui';
import { Edit } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useMergeState from 'use-merge-value';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import ConfigLayout from '../ConfigLayout';
import Header from './Header';
import SystemRole from './SystemRole';

const AgentConfig = memo(() => {
  const [editing, setEditing] = useState(false);

  const [init, sessionId] = useSessionStore((s) => [
    sessionSelectors.isSomeSessionActive(s),
    s.activeId,
  ]);

  const [isAgentConfigLoading] = useAgentStore((s) => [agentSelectors.isAgentConfigLoading(s)]);

  const [showSystemRole, toggleSystemRole] = useGlobalStore((s) => [
    systemStatusSelectors.showSystemRole(s),
    s.toggleSystemRole,
  ]);

  const [open, setOpen] = useMergeState(false, {
    defaultValue: showSystemRole,
    onChange: toggleSystemRole,
    value: showSystemRole,
  });

  const { t } = useTranslation('common');

  const isLoading = !init || isAgentConfigLoading;

  const handleOpenWithEdit = (e: MouseEvent) => {
    if (isLoading) return;

    e.stopPropagation();
    setEditing(true);
    setOpen(true);
  };

  return (
    <ConfigLayout
      expandedHeight={200}
      headerStyle={{ cursor: 'pointer' }}
      sessionId={sessionId}
      title={<Header />}
      actions={
        <ActionIcon icon={Edit} size={'small'} title={t('edit')} onClick={handleOpenWithEdit} />
      }
    >
      <SystemRole
        editing={editing}
        isLoading={isLoading}
        open={open}
        setEditing={setEditing}
        setOpen={setOpen}
      />
    </ConfigLayout>
  );
});

AgentConfig.displayName = 'AgentConfig';

export default AgentConfig;
