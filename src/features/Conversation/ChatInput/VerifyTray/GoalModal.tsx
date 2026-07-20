'use client';

import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface GoalContentProps {
  initialGoal?: string;
  onSubmit: (goal: string) => void | Promise<unknown>;
}

const GoalContent = memo<GoalContentProps>(({ initialGoal, onSubmit }) => {
  const { t: tv } = useTranslation('verify');
  const { close } = useModalContext();
  const [goal, setGoal] = useState(initialGoal ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = goal.trim();
    if (!trimmed || saving) return;
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
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={saving} onClick={close}>
          {tv('acceptance.actions.cancel')}
        </Button>
        <Button
          disabled={!goal.trim() || saving}
          loading={saving}
          type={'primary'}
          onClick={handleSave}
        >
          {tv('acceptance.tray.goalModal.save')}
        </Button>
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
