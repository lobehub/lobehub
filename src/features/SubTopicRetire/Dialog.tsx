'use client';

import { Button, Checkbox, createModal, Flexbox, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type RetireAction = 'archive' | 'trash';
export type RetireChoice = 'all' | 'self';

/** What the user picked; `removeFiles` is the delete confirm's attachment choice (trash only). */
export interface RetireDecision {
  mode: RetireChoice;
  removeFiles: boolean;
}

interface DialogProps {
  action: RetireAction;
  descendants: number;
  onChoose: (decision: RetireDecision | null) => void;
  running: number;
  title: string;
}

const RetireSubTopicsContent = memo<DialogProps>(
  ({ action, descendants, onChoose, running, title }) => {
    const { t } = useTranslation('topic');
    const { close } = useModalContext();
    // Same default as the ordinary delete confirm: uploads go with the topics
    // unless the user unchecks it.
    const [removeFiles, setRemoveFiles] = useState(true);
    const choose = (mode: RetireChoice | null) => {
      onChoose(mode ? { mode, removeFiles } : null);
      close();
    };

    return (
      <Flexbox gap={16}>
        <Text>
          {t(`subTopic.retire.${action}.description`, { count: descendants, title })}
          {running > 0 && ` ${t(`subTopic.retire.${action}.running`, { count: running })}`}
        </Text>
        {action === 'trash' && (
          <Checkbox checked={removeFiles} onChange={setRemoveFiles}>
            {t('actions.confirmRemoveTopicFiles')}
          </Checkbox>
        )}
        <Flexbox horizontal gap={8} justify={'flex-end'} wrap={'wrap'}>
          <Button onClick={() => choose(null)}>{t('cancel', { ns: 'common' })}</Button>
          <Button danger={action === 'trash'} onClick={() => choose('all')}>
            {t(`subTopic.retire.${action}.all`, { count: descendants + 1 })}
          </Button>
          <Button autoFocus type={'primary'} onClick={() => choose('self')}>
            {t(`subTopic.retire.${action}.self`)}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

RetireSubTopicsContent.displayName = 'RetireSubTopicsContent';

/**
 * Ask what happens to a topic's sub-topics when it is archived or trashed.
 * Resolves with the choice, or null when dismissed. "Only this one" is the
 * default: it is the choice that never stops or hides anything else.
 */
export const askRetireSubTopics = (
  params: Omit<DialogProps, 'onChoose'>,
): Promise<RetireDecision | null> =>
  new Promise((resolve) => {
    let settled = false;
    const settle = (decision: RetireDecision | null) => {
      if (settled) return;
      settled = true;
      resolve(decision);
    };
    createModal({
      content: <RetireSubTopicsContent {...params} onChoose={settle} />,
      maskClosable: true,
      onOpenChangeComplete: (open: boolean) => {
        if (!open) settle(null);
      },
      title: t(`subTopic.retire.${params.action}.title`, { ns: 'topic' }),
      width: 'min(92vw, 480px)',
    });
  });
