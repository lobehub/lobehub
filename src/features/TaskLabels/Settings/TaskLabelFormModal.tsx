import {
  DEFAULT_TASK_LABEL_COLOR,
  TASK_LABEL_COLORS,
  TASK_LABEL_NAME_MAX_LENGTH,
  type TaskLabelWithUsage,
} from '@lobechat/types';
import {
  Button,
  createModal,
  Flexbox,
  Input,
  ModalFooter,
  Select,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
import { isDuplicateLabelNameError } from '@/features/WorkspaceSetting/Labels/errors';
import { useTaskStore } from '@/store/task';
import { taskLabelSelectors } from '@/store/task/selectors';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  swatch: {
    cursor: 'pointer',
    width: 20,
    height: 20,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: '50%',
    transitionProperty: 'transform',
    transitionDuration: cssVar.motionDurationFast,
    transform: { 'default': null, ':hover': 'scale(1.15)' },
  },
  swatchActive: {
    borderColor: cssVar.colorText,
  },
});

export interface TaskLabelFormModalOptions {
  /** Creating a group rather than a label. */
  isGroup?: boolean;
  /** Present when editing. */
  label?: TaskLabelWithUsage;
  /** Prefill the group when creating a label from a group row. */
  parentId?: string | null;
}

const NO_GROUP = '__none__';

const TaskLabelFormContent = memo<TaskLabelFormModalOptions>(({ isGroup, label, parentId }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const createTaskLabel = useTaskStore((s) => s.createTaskLabel);
  const updateTaskLabel = useTaskStore((s) => s.updateTaskLabel);
  const groups = useTaskStore(taskLabelSelectors.labelGroups);

  const editingGroup = label?.isGroup ?? !!isGroup;
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState<string>(label?.color ?? DEFAULT_TASK_LABEL_COLOR);
  const [group, setGroup] = useState<string>(label?.parentId ?? parentId ?? NO_GROUP);
  const [loading, setLoading] = useState(false);
  /**
   * Save failures stay in the modal: a name clash shows under the name input, a regroup
   * conflict under the group select, any other failure above the footer buttons.
   */
  const [nameError, setNameError] = useState('');
  const [groupError, setGroupError] = useState('');
  const [saveError, setSaveError] = useState<InlineErrorState | null>(null);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    const nextParentId = editingGroup || group === NO_GROUP ? null : group;

    setNameError('');
    setGroupError('');
    setSaveError(null);
    setLoading(true);
    try {
      if (label) {
        await updateTaskLabel(label.id, {
          color,
          name: trimmed,
          ...(editingGroup || nextParentId === (label.parentId ?? null)
            ? {}
            : { parentId: nextParentId }),
        });
      } else {
        await createTaskLabel({
          color,
          isGroup: editingGroup,
          name: trimmed,
          parentId: nextParentId,
        });
      }
      close();
    } catch (error) {
      if (isDuplicateLabelNameError(error)) {
        setNameError(t('taskLabels.form.duplicateName'));
        return;
      }
      // Server messages are English (they also serve the CLI and agents), so
      // only map the known rule error. A BAD_REQUEST here is a regroup that
      // collides with tasks already carrying a sibling.
      const code = (error as { data?: { code?: string } })?.data?.code;
      const isRegroup = !!label && !!nextParentId && nextParentId !== (label.parentId ?? null);
      if (code === 'BAD_REQUEST' && isRegroup) {
        setGroupError(t('taskLabels.form.groupConflict'));
      } else {
        console.error('Failed to save task label:', error);
        setSaveError(toInlineError(t('taskLabels.form.saveFailedRetry'), error));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Flexbox gap={16} paddingBlock={8} paddingInline={16}>
        <Flexbox gap={8}>
          <span>{t('taskLabels.form.name')}</span>
          <Input
            autoFocus
            aria-invalid={!!nameError}
            data-invalid={nameError ? '' : undefined}
            maxLength={TASK_LABEL_NAME_MAX_LENGTH}
            value={name}
            placeholder={t(
              editingGroup
                ? 'taskLabels.form.groupNamePlaceholder'
                : 'taskLabels.form.namePlaceholder',
            )}
            onPressEnter={handleSave}
            onChange={(e) => {
              setName(e.target.value);
              setNameError('');
            }}
          />
          {nameError && (
            <span role={'alert'} style={{ color: cssVar.colorError, fontSize: 12 }}>
              {nameError}
            </span>
          )}
        </Flexbox>
        {!editingGroup && groups.length > 0 && (
          <Flexbox gap={8}>
            <span>{t('taskLabels.form.group')}</span>
            <Select
              value={group}
              options={[
                { label: t('taskLabels.form.noGroup'), value: NO_GROUP },
                ...groups.map((item) => ({ label: item.name, value: item.id })),
              ]}
              onChange={(value: string) => {
                setGroup(value);
                setGroupError('');
              }}
            />
            {groupError && (
              <span role={'alert'} style={{ color: cssVar.colorError, fontSize: 12 }}>
                {groupError}
              </span>
            )}
          </Flexbox>
        )}
        <Flexbox gap={8}>
          <span>{t('taskLabels.form.color')}</span>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            {TASK_LABEL_COLORS.map((preset) => (
              <span
                aria-label={preset}
                key={preset}
                role={'button'}
                {...sx(styles.swatch, color === preset && styles.swatchActive, {
                  backgroundColor: preset,
                })}
                onClick={() => setColor(preset)}
              />
            ))}
          </Flexbox>
        </Flexbox>
        {saveError && (
          <InlineErrorText detail={saveError.detail}>{saveError.summary}</InlineErrorText>
        )}
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button disabled={!name.trim()} loading={loading} type={'primary'} onClick={handleSave}>
          {t('ok', { defaultValue: 'OK', ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
});

TaskLabelFormContent.displayName = 'TaskLabelFormContent';

export const openTaskLabelFormModal = (options: TaskLabelFormModalOptions = {}) => {
  const isGroup = options.label?.isGroup ?? options.isGroup;
  return createModal({
    content: <TaskLabelFormContent {...options} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate(
      options.label
        ? isGroup
          ? 'taskLabels.form.editGroupTitle'
          : 'taskLabels.form.editTitle'
        : isGroup
          ? 'taskLabels.form.createGroupTitle'
          : 'taskLabels.form.createTitle',
      { ns: 'setting' },
    ),
    width: 420,
  });
};
