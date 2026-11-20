'use client';

import { Alert, Button, Flexbox, Input, Text, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeleteProjectConfirm } from './useDeleteProjectConfirm';

const styles = stylex.create({
  fieldLabel: {
    color: cssVar.colorTextSecondary,
  },
  item: {
    marginBlock: 2,
  },
  list: {
    margin: 0,
    paddingInlineStart: 18,
  },
});

// Keep in sync with the `projects.id` foreign keys in `packages/database/src/schemas`
// and `ProjectModel.delete`: `ON DELETE CASCADE` rows go with the project, while
// tasks, goals, topics and channels are `SET NULL` and survive unlinked.
const REMOVED_ITEMS = ['settings', 'bindings', 'automation'] as const;
const KEPT_ITEMS = ['work', 'files'] as const;

interface ContentProps {
  onConfirm: () => Promise<void>;
  project: { id: string; name: string };
}

const Content = memo<ContentProps>(({ project, onConfirm }) => {
  const { t } = useTranslation(['project', 'common']);
  const { close } = useModalContext();
  const { canContinue, loading, nameInput, setNameInput, submit } = useDeleteProjectConfirm({
    close,
    onConfirm,
    projectName: project.name,
  });
  const namePrompt = t('delete.confirm.namePrompt', { name: project.name });

  return (
    <Flexbox gap={20} padding={24}>
      <Alert
        showIcon
        type="warning"
        message={
          <Flexbox gap={6}>
            <Text>{t('delete.confirm.removedLead', { name: project.name })}</Text>
            <ul {...stylex.props(styles.list)}>
              {REMOVED_ITEMS.map((key) => (
                <li key={key} {...stylex.props(styles.item)}>
                  {t(`delete.confirm.removed.${key}`)}
                </li>
              ))}
            </ul>
            <Text>{t('delete.confirm.keptLead')}</Text>
            <ul {...stylex.props(styles.list)}>
              {KEPT_ITEMS.map((key) => (
                <li key={key} {...stylex.props(styles.item)}>
                  {t(`delete.confirm.kept.${key}`)}
                </li>
              ))}
            </ul>
          </Flexbox>
        }
      />

      <Flexbox gap={8}>
        <Text {...stylex.props(styles.fieldLabel)}>{namePrompt}</Text>
        <Input
          autoFocus
          aria-label={namePrompt}
          placeholder={project.name}
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onPressEnter={() => void submit()}
        />
      </Flexbox>

      <Flexbox horizontal align="center" distribution="space-between">
        <Button disabled={loading} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          danger
          disabled={!canContinue}
          loading={loading}
          type="primary"
          onClick={() => void submit()}
        >
          {t('delete.confirm.continue')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

Content.displayName = 'DeleteProjectModalContent';

export { Content };
