import { Button, Flexbox, Input, TextArea } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import SettingCard from '@/components/SettingCard';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';

import { isProjectSlugValid } from '../createProjectForm';
import { useProjectLogo, useSaveProjectField } from './useProjectGeneralSettings';

const NAME_MAX = 255;
const SLUG_MAX = 100;

type Project = ProjectDetail['project'];

interface CardProps {
  project: Project;
}

const SaveButton = ({
  disabled,
  loading,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <Button disabled={disabled || loading} loading={loading} type="primary" onClick={onClick}>
      {t('save')}
    </Button>
  );
};

const LogoCard = ({ project }: CardProps) => {
  const { t } = useTranslation('project');
  const { avatar, busy, onChange, onDelete, onUpload } = useProjectLogo(project);

  return (
    <SettingCard
      description={t('settings.logoDescription')}
      hint={t('settings.logoHint')}
      title={t('settings.logo')}
      extra={
        <EmojiPicker
          allowDelete={!!avatar}
          allowUpload={{ enableEmoji: true }}
          loading={busy}
          shape="square"
          size={80}
          // Seeds the generated avatar shown while the project has no logo.
          title={project.name}
          value={avatar || undefined}
          onChange={onChange}
          onDelete={onDelete}
          onUpload={onUpload}
        />
      }
    />
  );
};

const NameCard = ({ project }: CardProps) => {
  const { t } = useTranslation('project');
  const { save, saving } = useSaveProjectField(project.id);
  const [name, setName] = useState(project.name);
  const trimmed = name.trim();

  return (
    <SettingCard
      hint={t('settings.nameHint')}
      title={t('create.nameLabel')}
      action={
        <SaveButton
          disabled={!trimmed || trimmed === project.name}
          loading={saving}
          onClick={() => save({ name: trimmed })}
        />
      }
    >
      <Input
        aria-label={t('create.nameLabel')}
        maxLength={NAME_MAX}
        style={{ maxWidth: 420 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </SettingCard>
  );
};

const IdentifierCard = ({ project }: CardProps) => {
  const { t } = useTranslation('project');

  return (
    <SettingCard description={t('settings.identifierDescription')} title={t('settings.identifier')}>
      <Input
        readOnly
        aria-label={t('settings.identifier')}
        style={{ maxWidth: 420 }}
        value={project.identifier ?? ''}
      />
    </SettingCard>
  );
};

const SlugCard = ({ project }: CardProps) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const { save, saving } = useSaveProjectField(project.id);
  const [slug, setSlug] = useState(project.slug ?? '');
  const valid = isProjectSlugValid(slug);

  const saveSlug = async () => {
    const saved = await save({ slug: slug.trim() || null });
    // The settings URL carries the slug, so follow it to the new address.
    if (saved) navigate(`/project/${saved.slug ?? saved.id}/settings/general`, { replace: true });
  };

  return (
    <SettingCard
      description={t('settings.slugDescription')}
      hint={valid ? undefined : t('create.slugInvalid')}
      title={t('create.slugLabel')}
      action={
        <SaveButton
          disabled={!valid || slug.trim() === (project.slug ?? '')}
          loading={saving}
          onClick={saveSlug}
        />
      }
    >
      <Input
        aria-invalid={!valid || undefined}
        aria-label={t('create.slugLabel')}
        maxLength={SLUG_MAX}
        style={{ maxWidth: 420 }}
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase())}
      />
    </SettingCard>
  );
};

const DescriptionCard = ({ project }: CardProps) => {
  const { t } = useTranslation('project');
  const { save, saving } = useSaveProjectField(project.id);
  const [description, setDescription] = useState(project.description ?? '');

  return (
    <SettingCard
      title={t('settings.description')}
      action={
        <SaveButton
          disabled={description.trim() === (project.description ?? '')}
          loading={saving}
          onClick={() => save({ description: description.trim() || null })}
        />
      }
    >
      <TextArea
        aria-label={t('settings.description')}
        autoSize={{ maxRows: 8, minRows: 3 }}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </SettingCard>
  );
};

export function GeneralSettings({ project }: CardProps) {
  return (
    <Flexbox gap={16}>
      <LogoCard project={project} />
      <NameCard project={project} />
      <IdentifierCard project={project} />
      <SlugCard project={project} />
      <DescriptionCard project={project} />
    </Flexbox>
  );
}
