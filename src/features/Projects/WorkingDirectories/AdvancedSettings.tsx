// FormKit migration is blocked on inline-validation support: `FormFieldProps` has no
// `help`/`validateStatus`, which this form uses for the slug field.

import { Button, Flexbox, Form, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';

import { createDeleteProjectModal } from '../DeleteProjectModal';
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
    createDeleteProjectModal({
      onConfirm: async () => {
        setPending(true);
        try {
          await deleteProject(project.id);
        } catch (error) {
          setPending(false);
          throw error;
        }
        toast.success(t('list.deleteSuccess', { name: project.name }));
        navigate('/projects', { replace: true });
      },
      project: { id: project.id, name: project.name },
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
            desc: t('delete.description'),
            minWidth: undefined,
            children: (
              <Button danger loading={pending} type="primary" onClick={confirmDelete}>
                {t('list.deleteAction')}
              </Button>
            ),
          },
        ]}
      />
    </Flexbox>
  );
}
