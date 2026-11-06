import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';

import { isProjectSlugValid } from '../createProjectForm';
import SettingsSaveBar from './SettingsSaveBar';
import { useGeneralSettingsForm } from './useProjectGeneralSettings';

const NAME_MAX = 255;
const SLUG_MAX = 100;

const styles = stylex.create({
  form: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  row: {
    borderBlockStartColor: {
      'default': cssVar.colorBorderSecondary,
      ':first-child': 'transparent',
    },
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    display: 'grid',
    gap: 16,
    gridTemplateColumns: { 'default': '180px minmax(0, 1fr)', '@media (max-width: 640px)': '1fr' },
    paddingBlock: 16,
    paddingInline: 20,
  },
});

interface RowProps {
  children: ReactNode;
  error?: string;
  hint?: string;
  label: string;
}

const Row = ({ children, error, hint, label }: RowProps) => (
  <div {...stylex.props(styles.row)}>
    <div {...stylex.props(styles.label)}>
      <Text fontSize={13} weight={500}>
        {label}
      </Text>
      {hint ? (
        <Text fontSize={12} type="secondary">
          {hint}
        </Text>
      ) : null}
    </div>
    <Flexbox gap={6}>
      {children}
      {error ? (
        <Text fontSize={12} type="danger">
          {error}
        </Text>
      ) : null}
    </Flexbox>
  </div>
);

interface GeneralSettingsProps {
  project: ProjectDetail['project'];
}

export function GeneralSettings({ project }: GeneralSettingsProps) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const { count, draft, logo, revert, save, saving, setField, valid } =
    useGeneralSettingsForm(project);
  const slugValid = isProjectSlugValid(draft.slug);

  const handleSave = async () => {
    const previousSlug = project.slug ?? null;
    const saved = await save();
    // The settings URL carries the slug, so follow it to the new address.
    if (saved && (saved.slug ?? null) !== previousSlug)
      navigate(`/project/${saved.slug ?? saved.id}/settings/general`, { replace: true });
  };

  return (
    <Flexbox gap={16}>
      <div {...stylex.props(styles.form)}>
        <Row hint={t('settings.logoHint')} label={t('settings.logoAndName')}>
          <Flexbox horizontal align="center" gap={12}>
            <EmojiPicker
              allowDelete={!!draft.avatar}
              allowUpload={{ enableEmoji: true }}
              loading={logo.busy}
              shape="square"
              size={40}
              // Seeds the generated avatar shown while the project has no logo.
              title={draft.name || project.name}
              value={draft.avatar || undefined}
              onChange={logo.onChange}
              onDelete={logo.onDelete}
              onUpload={logo.onUpload}
            />
            <Input
              aria-label={t('create.nameLabel')}
              maxLength={NAME_MAX}
              style={{ flex: 1 }}
              value={draft.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          </Flexbox>
        </Row>
        <Row
          error={slugValid ? undefined : t('create.slugInvalid')}
          hint={t('settings.slugDescription')}
          label={t('create.slugLabel')}
        >
          <Input
            aria-invalid={!slugValid || undefined}
            aria-label={t('create.slugLabel')}
            maxLength={SLUG_MAX}
            value={draft.slug}
            onChange={(e) => setField('slug', e.target.value.toLowerCase())}
          />
        </Row>
        <Row hint={t('settings.identifierDescription')} label={t('settings.identifier')}>
          <Input readOnly aria-label={t('settings.identifier')} value={project.identifier ?? ''} />
        </Row>
        <Row label={t('settings.description')}>
          <TextArea
            aria-label={t('settings.description')}
            autoSize={{ maxRows: 8, minRows: 3 }}
            value={draft.description}
            onChange={(e) => setField('description', e.target.value)}
          />
        </Row>
      </div>
      <SettingsSaveBar
        count={count}
        disabled={!valid}
        saving={saving}
        onRevert={revert}
        onSave={handleSave}
      />
    </Flexbox>
  );
}
