import {
  ActionIcon,
  Block,
  Button,
  confirmModal,
  cssVar,
  Flexbox,
  Switch,
  Text,
  toast,
} from '@lobehub/ui';
import { LinkIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import KnowledgeIcon from '@/components/KnowledgeIcon';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';
import { KnowledgeType } from '@/types/knowledgeBase';

import { openAddKnowledgeBaseModal } from './AddKnowledgeBaseModal';

type ProjectKnowledgeBase = NonNullable<ProjectDetail['knowledgeBases']>[number];

export function ProjectKnowledgeBaseSettings({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const updateProjectKnowledgeBase = useProjectStore((s) => s.updateProjectKnowledgeBase);
  const removeProjectKnowledgeBase = useProjectStore((s) => s.removeProjectKnowledgeBase);
  const projectId = detail.project.id;
  const canManage = detail.permissions?.canManageKnowledgeBases ?? false;
  const items = detail.knowledgeBases ?? [];
  const isShared = Boolean(detail.project.workspaceId) && detail.project.visibility === 'public';

  const toggle = async (item: ProjectKnowledgeBase, enabled: boolean) => {
    try {
      await updateProjectKnowledgeBase(projectId, item.knowledgeBase.id, { enabled });
    } catch (error) {
      console.error('Failed to update project knowledge base', error);
      toast.error(t('knowledgeBases.updateFailed'));
    }
  };

  const remove = (item: ProjectKnowledgeBase) =>
    confirmModal({
      content: t('knowledgeBases.removeConfirmDescription'),
      okButtonProps: { danger: true },
      okText: t('knowledgeBases.remove'),
      onOk: async () => {
        try {
          await removeProjectKnowledgeBase(projectId, item.knowledgeBase.id);
        } catch (error) {
          console.error('Failed to remove project knowledge base', error);
          toast.error(t('knowledgeBases.removeFailed'));
        }
      },
      title: t('knowledgeBases.removeConfirmTitle', { name: item.knowledgeBase.name }),
    });

  const openPicker = () =>
    openAddKnowledgeBaseModal({
      existingIds: items.map((item) => item.knowledgeBase.id),
      projectId,
      visibility: isShared ? 'public' : undefined,
    });

  return (
    <Flexbox gap={20}>
      <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
        <Flexbox gap={6}>
          <Text fontSize={16} weight={600}>
            {t('settings.knowledgeBases')}
          </Text>
          <Text type="secondary">{t('knowledgeBases.description')}</Text>
        </Flexbox>
        <Button disabled={!canManage} icon={LinkIcon} type="primary" onClick={openPicker}>
          {t('knowledgeBases.link')}
        </Button>
      </Flexbox>
      {items.length === 0 ? (
        <Flexbox gap={12} paddingBlock={24}>
          <Text type="secondary">{t('knowledgeBases.empty')}</Text>
        </Flexbox>
      ) : (
        <Block padding={0} variant="outlined">
          {items.map((item, index) => (
            <Flexbox
              horizontal
              align="center"
              gap={12}
              key={item.knowledgeBase.id}
              padding={16}
              style={index ? { borderTop: `1px solid ${cssVar.colorBorderSecondary}` } : undefined}
            >
              <KnowledgeIcon
                name={item.knowledgeBase.name}
                size={28}
                type={KnowledgeType.KnowledgeBase}
              />
              <Flexbox
                flex={1}
                gap={2}
                style={{ cursor: 'pointer', minWidth: 0 }}
                onClick={() => navigate(`/resource/library/${item.knowledgeBase.id}`)}
              >
                <Text ellipsis weight={500}>
                  {item.knowledgeBase.name}
                </Text>
                {item.knowledgeBase.description ? (
                  <Text ellipsis fontSize={12} type="secondary">
                    {item.knowledgeBase.description}
                  </Text>
                ) : null}
              </Flexbox>
              {canManage && (
                <>
                  <Switch
                    aria-label={t('knowledgeBases.enabled')}
                    size="small"
                    value={item.binding.enabled}
                    onChange={(enabled) => toggle(item, enabled)}
                  />
                  <ActionIcon
                    icon={Trash2Icon}
                    size="small"
                    title={t('knowledgeBases.remove')}
                    onClick={() => remove(item)}
                  />
                </>
              )}
            </Flexbox>
          ))}
        </Block>
      )}
    </Flexbox>
  );
}
