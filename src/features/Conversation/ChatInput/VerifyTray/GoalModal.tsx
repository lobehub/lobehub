'use client';

import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface GoalContentProps {
  initialGoal?: string;
  /** Clear the topic's goal. Only offered when editing an existing goal. */
  onDelete?: () => void | Promise<unknown>;
  onSubmit: (goal: string) => void | Promise<unknown>;
}

export const GoalContent = memo<GoalContentProps>(({ initialGoal, onDelete, onSubmit }) => {
  const { t: tv } = useTranslation('verify');
  const { close } = useModalContext();
  const [goal, setGoal] = useState(initialGoal ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = saving || deleting;

  const handleSave = async () => {
    const trimmed = goal.trim();
    if (!trimmed || busy) return;
    setSaving(true);
    try {
      // Only close once the write actually lands — a failed save (surfaced by
      // the caller) keeps the modal open so the edit isn't silently lost.
      await onSubmit(trimmed);
      close();
    } catch {
      // The caller already rolled back the optimistic value and toasted.
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || busy) return;
    setDeleting(true);
    try {
      // Mirror handleSave: await the write and only close once it lands. A
      // failed delete (offline / topic deleted) is rolled back and toasted by
      // the caller, so keep the modal open instead of closing on a rejection
      // whose promise would otherwise go unhandled.
      await onDelete();
      close();
    } catch {
      // The caller already rolled back the optimistic value and toasted.
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Text fontSize={13} type={'secondary'}>
        {tv('acceptance.tray.goalModal.hint')}
      </Text>
      <TextArea
        autoSize={{ maxRows: 5, minRows: 3 }}
        placeholder={tv('acceptance.tray.goalModal.placeholder')}
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
      />
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        {onDelete ? (
          <Button danger disabled={busy} loading={deleting} type={'text'} onClick={handleDelete}>
            {tv('acceptance.tray.goalModal.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Flexbox horizontal gap={8}>
          <Button disabled={busy} onClick={close}>
            {tv('acceptance.actions.cancel')}
          </Button>
          <Button
            disabled={!goal.trim() || busy}
            loading={saving}
            type={'primary'}
            onClick={handleSave}
          >
            {tv('acceptance.tray.goalModal.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

GoalContent.displayName = 'VerifyTrayGoalContent';

export const openGoalModal = (options: GoalContentProps): ModalInstance =>
  createModal({
    content: <GoalContent {...options} />,
    footer: null,
    maskClosable: true,
    title: options.initialGoal
      ? t('acceptance.tray.goalModal.editTitle', { ns: 'verify' })
      : t('acceptance.tray.goalModal.setTitle', { ns: 'verify' }),
    width: 'min(90vw, 520px)',
  });
