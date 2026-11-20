import { ActionIcon, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { CheckIcon, ExternalLinkIcon, MoreHorizontalIcon, PlusIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildFilePath, buildLibraryPath } from '@/features/ResourceManager/utils/resourcePath';
import { useAgentStore } from '@/store/agent';
import { KnowledgeType } from '@/types/knowledgeBase';

interface ActionsProps {
  enabled?: boolean;
  id: string;
  type: KnowledgeType;
}

/**
 * A row's add / attached control. Adding is a single round "+"; an attached row says so in words and
 * keeps removal one step away behind "…", so a stray click on the state never detaches it.
 */
const Actions = memo<ActionsProps>(({ id, type, enabled }) => {
  const { t } = useTranslation('chat');

  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const [
    addFilesToAgent,
    addKnowledgeBasesToAgent,
    removeFilesFromAgent,
    removeKnowledgeBasesFromAgent,
  ] = useAgentStore((s) => [
    s.addFilesToAgent,
    s.addKnowledgeBaseToAgent,
    s.removeFileFromAgent,
    s.removeKnowledgeBaseFromAgent,
  ]);

  const [loading, setLoading] = useState(false);
  const isLibrary = type === KnowledgeType.KnowledgeBase;

  const run = async (task: () => Promise<void>) => {
    setLoading(true);
    try {
      await task();
    } finally {
      setLoading(false);
    }
  };

  const assignKnowledge = () =>
    run(() => (isLibrary ? addKnowledgeBasesToAgent(id) : addFilesToAgent([id], true)));

  const removeKnowledge = () =>
    run(() => (isLibrary ? removeKnowledgeBasesFromAgent(id) : removeFilesFromAgent(id)));

  if (!enabled)
    return (
      <ActionIcon
        icon={PlusIcon}
        loading={loading}
        size={'small'}
        style={{ borderRadius: '50%' }}
        title={t('knowledgeBase.library.action.add')}
        variant={'filled'}
        onClick={assignKnowledge}
      />
    );

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={CheckIcon} size={14} />
        <Text fontSize={12} type={'secondary'}>
          {t('knowledgeBase.library.action.added')}
        </Text>
      </Flexbox>
      <DropdownMenu
        placement={'bottomRight'}
        items={[
          {
            icon: <Icon icon={ExternalLinkIcon} />,
            key: 'detail',
            label: t('knowledgeBase.library.action.detail'),
            onClick: () => {
              window.open(
                isLibrary
                  ? buildLibraryPath(id, activeWorkspaceSlug)
                  : buildFilePath(id, activeWorkspaceSlug),
              );
            },
          },
          {
            danger: true,
            icon: <Icon icon={Trash2} />,
            key: 'remove',
            label: t('knowledgeBase.library.action.remove'),
            onClick: removeKnowledge,
          },
        ]}
      >
        <ActionIcon icon={MoreHorizontalIcon} loading={loading} size={'small'} />
      </DropdownMenu>
    </Flexbox>
  );
});

export default Actions;
