'use client';

import { Button, Flexbox, Input, Text, TextArea, useModalContext } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';

import { useAddTaskForm } from './useAddTaskForm';

/**
 * Add a Task to a running goal. A task the coordinator will spend rounds on
 * deserves a titled brief, not a one-line inline input — the modal gives the
 * instruction room and keeps the frontier list itself read-focused.
 */

export interface AddTaskContentProps {
  onAdd: (title: string, description?: string) => Promise<void>;
}

const AddTaskContent = memo<AddTaskContentProps>(({ onAdd }) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const { busy, description, error, setDescription, setTitle, submit, title } = useAddTaskForm({
    onAdd,
    onDone: () => close(),
  });

  return (
    <Flexbox gap={16} paddingBlock={'4px 8px'}>
      <Flexbox gap={6}>
        <Text fontSize={13} weight={500}>
          {t('goalProcess.addTask.titleLabel')}
        </Text>
        <Input
          autoFocus
          placeholder={t('goalProcess.addTask.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={() => void submit()}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <Text fontSize={13} weight={500}>
          {t('goalProcess.addTask.descriptionLabel')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 8, minRows: 3 }}
          placeholder={t('goalProcess.addTask.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flexbox>
      {error && <InlineErrorText detail={error.detail}>{error.summary}</InlineErrorText>}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={() => close()}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={!title.trim()}
          loading={busy}
          type={'primary'}
          onClick={() => void submit()}
        >
          {t('goalProcess.frontier.add')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

AddTaskContent.displayName = 'AddGoalTaskContent';

export default AddTaskContent;
