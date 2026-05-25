import { Accordion, Flexbox } from '@lobehub/ui';
import { LayoutGrid } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useChatStore } from '@/store/chat';

import TaskList from './Task';
import Topic from './Topic';

export enum ChatSidebarKey {
  Tasks = 'tasks',
  Topic = 'topic',
}

const ManageTopicsNavItem = memo(() => {
  const { t } = useTranslation('topic');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeAgentId = useChatStore((s) => s.activeAgentId);

  if (!activeAgentId) return null;

  const path = urlJoin('/agent', activeAgentId, 'topics');
  const active = pathname === path;

  return (
    <Flexbox paddingInline={4}>
      <NavItem
        active={active}
        href={path}
        icon={LayoutGrid}
        title={t('management.sidebarEntry')}
        onClick={() => navigate(path)}
      />
    </Flexbox>
  );
});

const Body = memo(() => {
  return (
    <Flexbox gap={4} paddingInline={4}>
      <ManageTopicsNavItem />
      <Accordion defaultExpandedKeys={[ChatSidebarKey.Topic]} gap={8}>
        <TaskList itemKey={ChatSidebarKey.Tasks} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
