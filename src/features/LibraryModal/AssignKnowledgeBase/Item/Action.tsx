import { ActionIcon, Button, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { InfoIcon, MoreVerticalIcon, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { useServerConfigStore } from '@/store/serverConfig';
import { KnowledgeType } from '@/types/knowledgeBase';

interface ActionsProps {
  enabled?: boolean;
  id: string;
  type: KnowledgeType;
}

const Actions = memo<ActionsProps>(({ id, type, enabled }) => {
  const { t } = useTranslation('chat');

  const mobile = useServerConfigStore((s) => s.isMobile);
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

  const assignKnowledge = async () => {
    setLoading(true);
    if (type === KnowledgeType.KnowledgeBase) {
      await addKnowledgeBasesToAgent(id);
    } else {
      await addFilesToAgent([id], true);
    }
    setLoading(false);
  };

  const removeKnowledge = async () => {
    setLoading(true);
    if (type === KnowledgeType.KnowledgeBase) {
      await removeKnowledgeBasesFromAgent(id);
    } else {
      await removeFilesFromAgent(id);
    }
    setLoading(false);
  };

  return (
    <Flexbox horizontal align={'center'}>
      {enabled ? (
        <DropdownMenu
          placement="bottomRight"
          items={[
            {
              icon: <Icon icon={InfoIcon} />,
              key: 'detail',
              label: t('knowledgeBase.library.action.detail'),
              onClick: () => {
                if (type === KnowledgeType.KnowledgeBase) {
                  window.open(`/resource/library/${id}`);
                  return;
                }

                window.open(`/resource?file=${id}`);
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
          <ActionIcon icon={MoreVerticalIcon} loading={loading} />
        </DropdownMenu>
      ) : (
        <Button
          loading={loading}
          size={mobile ? 'small' : undefined}
          type={'primary'}
          onClick={assignKnowledge}
        >
          {t('knowledgeBase.library.action.add')}
        </Button>
      )}
    </Flexbox>
  );
});

export default Actions;
