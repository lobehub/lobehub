'use client';

import { agentDisplayName } from '@lobechat/types';
import {
  Button,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  Text,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronsUpDownIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE } from '@/const/meta';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import AgentList from './AgentList';
import moduleStyles from './index.module.css';
import { useResolvedHomeAgentId } from './useResolvedHomeAgentId';

const styles = stylex.create({
  popup: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    width: '360px',
    maxWidth: 'calc(100vw - 16px)',
  },
  name: {
    fontSize: '14px',
    lineHeight: '20px',
  },
});

const AgentSelect = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const [open, setOpen] = useState(false);
  const { error, mutate } = useFetchAgentList();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const { agentId: resolvedAgentId, isInbox } = useResolvedHomeAgentId();
  const displayAgentId = resolvedAgentId ?? '';
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId ?? ''));
  const sidebarItem = useHomeStore(homeAgentListSelectors.getAgentById(displayAgentId));
  const agentMapMeta = useAgentStore(agentSelectors.getAgentMetaById(displayAgentId));
  const showInboxFallback = isInbox || !resolvedAgentId;
  const displayMeta = showInboxFallback ? inboxMeta : (sidebarItem ?? agentMapMeta);
  const displayTitle = agentDisplayName(
    displayMeta,
    showInboxFallback ? DEFAULT_INBOX_TITLE : t('defaultSession', { ns: 'common' }),
  );
  const displayAvatar =
    (typeof displayMeta?.avatar === 'string' ? displayMeta.avatar : undefined) ||
    (showInboxFallback ? DEFAULT_INBOX_AVATAR : undefined);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  const handleSelect = useCallback(
    (agentId: string) => {
      updateSystemStatus({ homeSelectedAgentId: agentId });
      setOpen(false);

      const agentState = useAgentStore.getState();
      if (agentState.agentMap[agentId]) return;

      agentService
        .getAgentConfigById(agentId)
        .then((config) => {
          if (config) agentState.internal_dispatchAgentMap(agentId, config);
        })
        .catch((error) => console.error('[AgentSelect] failed to prefetch agent config', error));
    },
    [updateSystemStatus],
  );

  return (
    <DropdownMenuRoot open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger>
        <Button
          aria-expanded={open}
          aria-haspopup={'menu'}
          className={moduleStyles.trigger}
          type={'text'}
        >
          <AgentAvatar
            agentId={showInboxFallback ? inboxAgentId : displayAgentId}
            avatar={displayAvatar}
            background={displayMeta?.backgroundColor || undefined}
            name={displayTitle}
            shape={'square'}
            size={24}
          />
          <Text
            ellipsis
            className={stylex.props(styles.name).className}
            style={{ minWidth: 0 }}
            weight={600}
          >
            {displayTitle}
          </Text>
          <ChevronsUpDownIcon className={moduleStyles.chevron} size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement={'bottomLeft'} sideOffset={8}>
          <DropdownMenuPopup className={stylex.props(styles.popup).className}>
            <AgentList
              activeAgentId={displayAgentId}
              error={error}
              onRetry={() => mutate()}
              onSelect={handleSelect}
            />
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

export default AgentSelect;
