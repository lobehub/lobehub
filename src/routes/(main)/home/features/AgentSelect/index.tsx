'use client';

import { ActionIcon, Avatar, Block, Popover, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
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
    opacity: 0;
    transition: opacity 0.2s ${cssVar.motionEaseOut};
  `,
  trigger: css`
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

  // Trigger fetching the home agent list so the popover content is ready when opened.
  useFetchAgentList();

  const isLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const { agentId: resolvedAgentId, isInbox: isInboxDisplay } = useResolvedHomeAgentId();
  const displayAgentId = resolvedAgentId ?? '';

  // Pull metadata for the displayed agent. Inbox uses agentSelectors directly;
  // non-inbox agents are looked up via the home agent list (sidebar-shaped meta)
  // with a fallback to agentSelectors when the agent map is hydrated for that id.
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId ?? ''));
  const sidebarItem = useHomeStore(homeAgentListSelectors.getAgentById(displayAgentId));
  const agentMapMeta = useAgentStore(agentSelectors.getAgentMetaById(displayAgentId));

  const displayMeta = isInboxDisplay ? inboxMeta : (sidebarItem ?? agentMapMeta);

  const fallbackTitle = isInboxDisplay ? 'Lobe AI' : t('defaultSession', { ns: 'common' });
  const displayTitle = displayMeta?.title || fallbackTitle;
  const displayAvatar =
    (typeof displayMeta?.avatar === 'string' ? displayMeta.avatar : undefined) ||
    (isInboxDisplay ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR);
  const displayBackground = displayMeta?.backgroundColor || undefined;

  const handleSelect = (agentId: string) => {
    // Persist selection (localStorage via systemStatus) so the home ChatInput
    // + send logic uses this agent across reloads. We always store a concrete
    // agent id — including inbox — because lodash `merge` skips `undefined`
    // source values, so we cannot clear the field by passing `undefined`.
    updateSystemStatus({ homeSelectedAgentId: agentId });
    setOpen(false);

    // Eagerly hydrate `agentMap` for the picked agent so the home ChatInput's
    // model/provider/vision selectors reflect the agent's real config, and the
    // upcoming sendMessage doesn't have to wait on a cold fetch. `useSend` also
    // awaits this on send as a safety net for the race-clicker case.
    const agentState = useAgentStore.getState();
    if (agentState.agentMap[agentId]) return;
    agentService
      .getAgentConfigById(agentId)
      .then((config) => {
        if (config) agentState.internal_dispatchAgentMap(agentId, config);
      })
      .catch((e) => console.error('[AgentSelect] failed to prefetch agent config', e));
  };

  if (isLoading) return <SkeletonItem height={40} padding={0} />;

  return (
    <Popover
      classNames={{ trigger: styles.trigger }}
      content={<AgentList activeAgentId={displayAgentId} onSelect={handleSelect} />}
      nativeButton={false}
      open={open}
      placement="bottomLeft"
      styles={{ content: { padding: 0, width: 360 } }}
      trigger="click"
      onOpenChange={setOpen}
    >
      <Block
        clickable
        horizontal
        align={'center'}
        gap={8}
        padding={4}
        style={{ marginInlineStart: -4, width: 'fit-content' }}
        variant={'borderless'}
      >
        <Avatar avatar={displayAvatar} background={displayBackground} shape={'square'} size={32} />
        <Text fontSize={16} weight={600}>
          {displayTitle}
        </Text>
        <ActionIcon
          className={`${styles.chevron} agent-select-chevron`}
          color={cssVar.colorTextDescription}
          icon={ChevronsUpDownIcon}
          size={{ blockSize: 24, size: 14 }}
        />
      </Block>
    </Popover>
  );
});

export default AgentSelect;
