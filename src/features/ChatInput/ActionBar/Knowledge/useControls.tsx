import { type ItemType } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ArrowRight, LibraryBig } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import CheckboxItem from '../components/CheckboxWithLoading';

const labelMaxWidth = 'min(400px, 56vw)';

export interface KnowledgeControls {
  enabledCount: number;
  items: ItemType[];
}

export const useControls = ({
  openAttachKnowledgeModal,
  setUpdating,
}: {
  openAttachKnowledgeModal: () => void;
  setUpdating: (updating: boolean) => void;
}) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();

  const files = useAgentStore((s) => agentByIdSelectors.getAgentFilesById(agentId)(s), isEqual);
  const knowledgeBases = useAgentStore(
    (s) => agentByIdSelectors.getAgentKnowledgeBasesById(agentId)(s),
    isEqual,
  );

  const [toggleFile, toggleKnowledgeBase] = useAgentStore((s) => [
    s.toggleFile,
    s.toggleKnowledgeBase,
  ]);
  const enabledCount =
    files.filter((item) => item.enabled).length +
    knowledgeBases.filter((item) => item.enabled).length;

  const relatedItems = [
    // first the files
    ...files.map((item) => ({
      icon: <FileIcon fileName={item.name} fileType={item.type} size={20} />,
      key: item.id,
      label: (
        <CheckboxItem
          checked={item.enabled}
          id={item.id}
          label={item.name}
          labelMaxWidth={labelMaxWidth}
          onUpdate={async (id, enabled) => {
            setUpdating(true);
            await toggleFile(id, enabled);
            setUpdating(false);
          }}
        />
      ),
    })),

    // then the knowledge bases
    ...knowledgeBases.map((item) => ({
      icon: <RepoIcon />,
      key: item.id,
      label: (
        <CheckboxItem
          checked={item.enabled}
          id={item.id}
          label={item.name}
          labelMaxWidth={labelMaxWidth}
          onUpdate={async (id, enabled) => {
            setUpdating(true);
            await toggleKnowledgeBase(id, enabled);
            setUpdating(false);
          }}
        />
      ),
    })),
  ];

  const items: ItemType[] = [
    ...(relatedItems.length > 0
      ? [
          {
            children: relatedItems,
            key: 'relativeFilesOrLibraries',
            label: t('knowledgeBase.relativeFilesOrLibraries'),
            type: 'group' as const,
          },
          {
            type: 'divider' as const,
          },
        ]
      : []),
    {
      extra: <Icon icon={ArrowRight} />,
      icon: LibraryBig,
      key: 'knowledge-base-store',
      label: t('knowledgeBase.viewMore'),
      onClick: () => {
        openAttachKnowledgeModal();
      },
    },
  ];

  return { enabledCount, items } satisfies KnowledgeControls;
};
