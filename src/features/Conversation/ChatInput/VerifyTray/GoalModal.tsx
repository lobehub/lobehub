'use client';

import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface GoalContentProps {
  initialGoal?: string;
  onSubmit: (goal: string) => void;
}

const GoalContent = memo<GoalContentProps>(({ initialGoal, onSubmit }) => {
  const { t: tv } = useTranslation('verify');
  const { close } = useModalContext();
  const [goal, setGoal] = useState(initialGoal ?? '');

  const handleSave = () => {
    const trimmed = goal.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    close();
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
        <Button onClick={close}>{tv('acceptance.actions.cancel')}</Button>
        <Button disabled={!goal.trim()} type={'primary'} onClick={handleSave}>
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
