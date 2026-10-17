import { Button, Flexbox, Form, Input, TextArea, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import EmojiPicker from '@/components/EmojiPicker';
import { FORM_STYLE } from '@/const/layoutTokens';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFileStore } from '@/store/file';
import type { ProjectDetail } from '@/store/project';
import { useProjectStore } from '@/store/project';

import { isProjectSlugValid } from '../createProjectForm';

const MAX_LOGO_SIZE = 2 * 1024 * 1024;

export function GeneralSettings({ project }: { project: ProjectDetail['project'] }) {
  const { t } = useTranslation('project');
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const [avatar, setAvatar] = useState<string | null>(project.avatar ?? null);
  const [uploading, setUploading] = useState(false);
  const navigate = useWorkspaceAwareNavigate();
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const updateProject = useProjectStore((s) => s.updateProject);

  const uploadLogo = async (file: File) => {
    if (file.size > MAX_LOGO_SIZE) {
      toast.error(t('settings.logoSizeExceeded'));
      return;
    }

    setUploading(true);
    try {
      const result = await uploadWithProgress({ file });
      if (!result?.url) {
        toast.error(t('settings.logoUploadFailed'));
        return;
      }
      setAvatar(result.url);
    } catch (error) {
      console.error('Failed to upload project logo', error);
      toast.error(t('settings.logoUploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      const saved = await updateProject(project.id, {
        name: name.trim(),
        slug: slug.trim() || null,
        description: description.trim() || null,
        avatar,
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
    uploading ||
    !name.trim() ||
    !isProjectSlugValid(slug) ||
    (name.trim() === project.name &&
      slug.trim() === (project.slug ?? '') &&
      description.trim() === (project.description ?? '') &&
      avatar === (project.avatar ?? null));

  return (
    <Flexbox gap={24}>
      <Form
        {...FORM_STYLE}
        collapsible={false}
        itemMinWidth="100%"
        itemsType="group"
        layout="vertical"
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
                label: t('settings.logo'),
                desc: t('settings.logoDescription'),
                children: (
                  <EmojiPicker
                    allowDelete={!!avatar}
                    allowUpload={{ enableEmoji: true }}
                    loading={uploading}
                    shape="square"
                    size={80}
                    value={avatar || undefined}
                    onDelete={() => setAvatar(null)}
                    onUpload={uploadLogo}
                    onChange={(next) => {
                      if (!next.startsWith('data:')) setAvatar(next || null);
                    }}
                  />
                ),
              },
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
                desc: t(
                  isProjectSlugValid(slug) ? 'settings.slugDescription' : 'create.slugInvalid',
                ),
                children: (
                  <Input
                    aria-invalid={!isProjectSlugValid(slug) || undefined}
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
    </Flexbox>
  );
}
