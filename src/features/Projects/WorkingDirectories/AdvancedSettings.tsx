// FormKit migration is blocked on inline-validation support: `FormFieldProps` has no
// `help`/`validateStatus`, which this form uses for the slug field.

import { Button, confirmModal, Flexbox, Form, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';

import { useProjectLinearSync } from '../LinearSync';
import { useCanManageProject } from '../useCanManageProject';

export function AdvancedSettings({ project }: { project: ProjectDetail['project'] }) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const canManage = useCanManageProject();
  const [pending, setPending] = useState(false);
  const linearSync = useProjectLinearSync(project.id);

  // Destructive settings need edit permission; the page hides this tab from viewers.
  if (!canManage) return null;

  const confirmDelete = () => {
    confirmModal({
      title: t('list.deleteConfirmTitle'),
      content: t('list.deleteConfirmDescription', { name: project.name }),
      okText: t('delete', { ns: 'common' }),
      cancelText: t('cancel', { ns: 'common' }),
      okButtonProps: { danger: true },
      onOk: async () => {
        setPending(true);
        try {
          await deleteProject(project.id);
          navigate('/projects', { replace: true });
        } catch (error) {
          console.error('Failed to delete project', error);
          toast.error(t('list.deleteError'));
          setPending(false);
          throw error;
        }
      },
    });
  };

  return (
    <Flexbox gap={24}>
      {linearSync.item ? (
        <Flexbox gap={16}>
          <Form {...FORM_STYLE} items={[linearSync.item]} itemsType="flat" variant="filled" />
          {linearSync.rules}
        </Flexbox>
      ) : (
        linearSync.rules
      )}
      <Form
        {...FORM_STYLE}
        itemsType="flat"
        variant="filled"
        items={[
          {
            label: t('list.deleteAction'),
            desc: t('list.deleteConfirmDescription', { name: project.name }),
            minWidth: undefined,
            children: (
              <Button danger disabled={pending} onClick={confirmDelete}>
                {t('list.deleteAction')}
              </Button>
            ),
          },
        ]}
      />
    </Flexbox>
  );
}
