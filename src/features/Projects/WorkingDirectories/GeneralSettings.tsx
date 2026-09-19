import { Flexbox, Form, Input, TextArea } from '@lobehub/ui';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { isProjectSlugValid } from '../createProjectForm';

export function GeneralSettings({ project }: { project: ProjectDetail['project'] }) {
  const { t } = useTranslation('project');
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const navigate = useWorkspaceAwareNavigate();
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const updateProject = useProjectStore((s) => s.updateProject);
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      const saved = await updateProject(project.id, {
        name: name.trim(),
        slug: slug.trim() || null,
        description: description.trim() || null,
      });
      navigate(`/project/${saved.slug ?? saved.id}/settings/general`, { replace: true });
      toast.success(t('rename.success'));
    } catch (error) {
      console.error('Failed to update project', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  const saveDisabled =
    pending ||
    !name.trim() ||
    !isProjectSlugValid(slug) ||
    (name.trim() === project.name &&
      slug.trim() === (project.slug ?? '') &&
      description.trim() === (project.description ?? ''));

  return (
    <Flexbox gap={24}>
      <Form
        {...FORM_STYLE}
        collapsible={false}
        itemsType="group"
        variant="filled"
        footer={
          <Flexbox gap={16}>
            {error ? <AsyncError error={error} onRetry={save} /> : null}
            <Flexbox horizontal justify="flex-end">
              <Button disabled={saveDisabled} loading={pending} type="primary" onClick={save}>
                {t('save', { ns: 'common' })}
              </Button>
            </Flexbox>
          </Flexbox>
        }
        items={[
          {
            title: t('settings.general'),
            children: [
              {
                label: t('create.nameLabel'),
                children: (
                  <Input
                    aria-label={t('create.nameLabel')}
                    disabled={pending}
                    maxLength={255}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                ),
              },
              {
                label: t('settings.identifier'),
                desc: t('settings.identifierDescription'),
                children: (
                  <Input
                    readOnly
                    aria-label={t('settings.identifier')}
                    value={project.identifier}
                  />
                ),
              },
              {
                label: t('create.slugLabel'),
                desc: t('settings.slugDescription'),
                help: isProjectSlugValid(slug) ? undefined : t('create.slugInvalid'),
                validateStatus: isProjectSlugValid(slug) ? undefined : 'error',
                children: (
                  <Input
                    aria-label={t('create.slugLabel')}
                    disabled={pending}
                    maxLength={100}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  />
                ),
              },
              {
                label: t('settings.description'),
                children: (
                  <TextArea
                    aria-label={t('settings.description')}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    disabled={pending}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                ),
              },
            ],
          },
        ]}
      />
      {currentUserId === project.userId && (
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
                <Button
                  danger
                  disabled={pending}
                  onClick={() =>
                    confirmModal({
                      title: t('list.deleteConfirmTitle'),
                      content: t('list.deleteConfirmDescription', { name: project.name }),
                      okText: t('delete', { ns: 'common' }),
                      cancelText: t('cancel', { ns: 'common' }),
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        try {
                          await deleteProject(project.id);
                          navigate('/projects', { replace: true });
                        } catch (error) {
                          console.error('Failed to delete project', error);
                          toast.error(t('list.deleteError'));
                          throw error;
                        }
                      },
                    })
                  }
                >
                  {t('list.deleteAction')}
                </Button>
              ),
            },
          ]}
        />
      )}
    </Flexbox>
  );
}
