'use client';

import { ActionIcon, Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PinIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeSidebarItem } from '@/client-data';
import AsyncBoundary from '@/components/AsyncBoundary';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { type AgentRowRef, useHomeAgentRows } from './useHomeAgentRows';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    background: ${cssVar.colorFillTertiary};
  `,
  item: css`
    cursor: pointer;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  list: css`
    padding: 8px;
  `,
  sectionHeader: css`
    padding-block: 4px;
    padding-inline: 8px;
    line-height: 20px;
  `,
}));

interface AgentListProps {
  activeAgentId: string;
  /** Thrown error from the agent-list SWR — surfaced as a failure state. */
  error?: unknown;
  onRetry?: () => void;
  onSelect: (agentId: string) => void;
}

// Same spec as the agent-detail SwitchPanel's section header.
const SectionHeader = memo<{ children: ReactNode }>(({ children }) => (
  <Flexbox className={styles.sectionHeader}>
    <Text fontSize={12} type={'secondary'} weight={500}>
      {children}
    </Text>
  </Flexbox>
));

interface AgentListItemProps {
  active: boolean;
  onSelect: (agentId: string) => void;
  row: AgentRowRef;
}

const AgentListItem = memo<AgentListItemProps>(({ active, onSelect, row }) => {
  const { t } = useTranslation('chat');
  const entityItem = useHomeSidebarItem(row.source === 'entity' ? row.ref : undefined);
  const builtinMeta = useAgentStore(
    agentSelectors.getAgentMetaById(row.source === 'builtin' ? row.id : ''),
  );

  if (row.source === 'entity' && !entityItem) return null;

  const title =
    row.source === 'builtin'
      ? builtinMeta?.title || 'Lobe AI'
      : entityItem?.title || t('untitledAgent');
  const avatarValue = row.source === 'builtin' ? builtinMeta?.avatar : entityItem?.avatar;
  const avatar =
    (typeof avatarValue === 'string' ? avatarValue : undefined) ||
    (row.source === 'builtin' ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR);
  const backgroundColor =
    (row.source === 'builtin' ? builtinMeta?.backgroundColor : entityItem?.backgroundColor) ||
    undefined;

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      className={`${styles.item} ${active ? styles.active : ''}`}
      gap={8}
      variant={'borderless'}
      onClick={() => onSelect(row.id)}
    >
      <Avatar avatar={avatar} background={backgroundColor} shape={'square'} size={24} />
      <Text
        ellipsis
        color={active ? cssVar.colorText : cssVar.colorTextSecondary}
        style={{ flex: 1 }}
        weight={active ? 600 : 500}
      >
        {title}
      </Text>
      {row.pinned && (
        <ActionIcon icon={PinIcon} size={12} style={{ opacity: 0.5, pointerEvents: 'none' }} />
      )}
    </Block>
  );
});

const AgentList = memo<AgentListProps>(({ activeAgentId, error, onRetry, onSelect }) => {
  const { t } = useTranslation('common');
  const { isInitialized, privateRows, showPrivateSection, workspaceRows } = useHomeAgentRows();

  const renderRow = (row: AgentRowRef) => (
    <AgentListItem active={row.id === activeAgentId} key={row.id} row={row} onSelect={onSelect} />
  );

  // Error gated ahead of the skeleton so a failed list fetch shows Retry instead
  // of a permanent skeleton (`isAgentListInit` only flips on success).
  return (
    <AsyncBoundary
      data={isInitialized ? workspaceRows : undefined}
      error={error}
      errorVariant={'block'}
      isLoading={!isInitialized && !error}
      loading={<SkeletonList rows={6} style={{ padding: 8 }} />}
      onRetry={onRetry}
    >
      <Flexbox
        className={styles.list}
        gap={2}
        style={{ maxHeight: 360, overflowY: 'auto', width: '100%' }}
      >
        {showPrivateSection ? (
          <>
            <SectionHeader>{t('navPanel.privateAgents')}</SectionHeader>
            {privateRows.map(renderRow)}
            <SectionHeader>{t('navPanel.publicAgents')}</SectionHeader>
            {workspaceRows.map(renderRow)}
          </>
        ) : (
          [...workspaceRows, ...privateRows].map(renderRow)
        )}
      </Flexbox>
    </AsyncBoundary>
  );
});

export default AgentList;
