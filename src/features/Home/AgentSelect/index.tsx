'use client';

import { agentDisplayName } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { Button, Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import AgentList from './AgentList';
import { useResolvedHomeAgentId } from './useResolvedHomeAgentId';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    color: ${cssVar.colorTextDescription};
    opacity: 0;
    transition: opacity 0.2s ${cssVar.motionEaseOut};
  `,
  name: css`
    font-size: 14px;
    line-height: 20px;
  `,
  trigger: css`
    gap: 8px;
    justify-content: flex-start;

    width: fit-content;
    min-width: 0;
    max-width: 100%;
    height: auto;
    margin-inline-start: -2px;
    padding: 2px;
    border: 0;

    background: transparent;

    &:hover .agent-select-chevron,
    &[data-popup-open] .agent-select-chevron {
      opacity: 1;
    }

    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

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
    showInboxFallback ? 'Lobe AI' : t('defaultSession', { ns: 'common' }),
  );
  const displayAvatar =
    (typeof displayMeta?.avatar === 'string' ? displayMeta.avatar : undefined) ||
    (showInboxFallback ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR);

  const handleSelect = (agentId: string) => {
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
  };

  return (
    <Popover
      classNames={{ trigger: styles.trigger }}
      open={open}
      placement={'bottomLeft'}
      styles={{ content: { padding: 0, width: 360 } }}
      trigger={'click'}
      content={
        <AgentList
          activeAgentId={displayAgentId}
          error={error}
          onRetry={() => mutate()}
          onSelect={handleSelect}
        />
      }
      onOpenChange={setOpen}
    >
      <Button aria-expanded={open} aria-haspopup={'dialog'} type={'text'}>
        <Avatar
          avatar={displayAvatar}
          background={displayMeta?.backgroundColor || undefined}
          name={displayTitle}
          shape={'square'}
          size={24}
        />
        <Text ellipsis className={styles.name} style={{ minWidth: 0 }} weight={600}>
          {displayTitle}
        </Text>
        <ChevronsUpDownIcon className={`${styles.chevron} agent-select-chevron`} size={12} />
      </Button>
    </Popover>
  );
});

export default AgentSelect;
