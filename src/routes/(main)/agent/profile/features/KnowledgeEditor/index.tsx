'use client';

import { ActionIcon, Button, Flexbox, Icon, Switch, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { PlusIcon, XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import { openAttachKnowledgeModal } from '@/features/LibraryModal';
import ItemRow from '@/features/ProfileEditor/ItemRow';
import ToolListGroup from '@/features/ProfileEditor/ToolListGroup';
import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import { resourceService } from '@/services/resource';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/** The most files counted for one library; past it the row says "N+". */
const COUNT_PAGE = 50;

/** How much is inside a library, so a row says what the agent can actually search. */
const LibraryCount = memo<{ id: string }>(({ id }) => {
  const { t } = useTranslation('setting');
  // One small, cached request per row, and not again on every focus: the count is a hint, so it
  // stops at a page rather than walking a large library.
  const { data } = useClientDataSWR(
    ['agent-library-count', id],
    () => resourceService.queryResources({ libraryId: id, limit: COUNT_PAGE }),
    { revalidateOnFocus: false },
  );
  if (!data) return null;

  // An older server may omit `items`; the count still falls back to zero rather than throwing.
  const items = data.items ?? [];
  const count = data.total ?? items.length;

  return (
    <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
      {data.hasMore && data.total === undefined
        ? t('settingAgent.knowledgePage.files.countMore', { count })
        : t('settingAgent.knowledgePage.files.count', { count })}
    </Text>
  );
});

LibraryCount.displayName = 'LibraryCount';

/**
 * The Knowledge Base page: the libraries and files this agent can search when it answers. Each
 * can be switched off without being removed, and adding opens the same picker as the chat input.
 */
const KnowledgeEditor = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const libraries = useAgentStore(
    (s) => agentByIdSelectors.getAgentKnowledgeBasesById(agentId)(s),
    isEqual,
  );
  const files = useAgentStore((s) => agentByIdSelectors.getAgentFilesById(agentId)(s), isEqual);
  const [toggleKnowledgeBase, toggleFile, removeKnowledgeBase, removeFile] = useAgentStore((s) => [
    s.toggleKnowledgeBase,
    s.toggleFile,
    s.removeKnowledgeBaseFromAgent,
    s.removeFileFromAgent,
  ]);

  const addControl = (label: string) => (
    <Button
      disabled={!canEdit}
      icon={<Icon icon={PlusIcon} />}
      size={'small'}
      type={'text'}
      onClick={() => openAttachKnowledgeModal()}
    >
      {label}
    </Button>
  );

  const actions = (
    enabled: boolean | undefined,
    onToggle: (next: boolean) => void,
    onRemove: () => void,
  ) => (
    <>
      <Switch checked={!!enabled} disabled={!canEdit} size={'small'} onChange={onToggle} />
      <ActionIcon
        disabled={!canEdit}
        icon={XIcon}
        size={'small'}
        title={t('settingAgent.knowledgePage.remove')}
        onClick={onRemove}
      />
    </>
  );

  return (
    <Flexbox gap={32} paddingBlock={'8px 48px'}>
      <Flexbox gap={4}>
        <Text fontSize={24} weight={600}>
          {t('settingAgent.knowledgePage.title')}
        </Text>
        <Text type={'secondary'}>{t('settingAgent.knowledgePage.desc')}</Text>
      </Flexbox>

      <Flexbox gap={16}>
        <ToolListGroup
          addControl={addControl(t('settingAgent.knowledgePage.addLibrary'))}
          desc={t('settingAgent.knowledgePage.libraries.desc')}
          emptyText={t('settingAgent.knowledgePage.libraries.empty')}
          title={t('settingAgent.knowledgePage.libraries.title')}
          rows={libraries.map((item) => (
            <ItemRow
              description={item.description ?? undefined}
              icon={<RepoIcon />}
              key={item.id}
              meta={<LibraryCount id={item.id} />}
              title={item.name}
              actions={actions(
                item.enabled,
                (next) => void toggleKnowledgeBase(item.id, next),
                () => void removeKnowledgeBase(item.id),
              )}
            />
          ))}
        />
        <ToolListGroup
          addControl={addControl(t('settingAgent.knowledgePage.addFile'))}
          desc={t('settingAgent.knowledgePage.files.desc')}
          emptyText={t('settingAgent.knowledgePage.files.empty')}
          title={t('settingAgent.knowledgePage.files.title')}
          rows={files.map((item) => (
            <ItemRow
              icon={<FileIcon fileName={item.name} fileType={item.type} size={20} />}
              key={item.id}
              title={item.name}
              actions={actions(
                item.enabled,
                (next) => void toggleFile(item.id, next),
                () => void removeFile(item.id),
              )}
            />
          ))}
        />
      </Flexbox>
    </Flexbox>
  );
});

KnowledgeEditor.displayName = 'KnowledgeEditor';

export default KnowledgeEditor;
