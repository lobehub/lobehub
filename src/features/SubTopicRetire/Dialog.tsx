'use client';

import { Button, createModal, Flexbox, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type RetireAction = 'archive' | 'trash';
export type RetireChoice = 'all' | 'self';

interface DialogProps {
  action: RetireAction;
  descendants: number;
  onChoose: (choice: RetireChoice | null) => void;
  running: number;
  title: string;
}

const RetireSubTopicsContent = memo<DialogProps>(
  ({ action, descendants, onChoose, running, title }) => {
    const { t } = useTranslation('topic');
    const { close } = useModalContext();
    const choose = (choice: RetireChoice | null) => {
      onChoose(choice);
      close();
    };

    return (
      <Flexbox gap={16}>
        <Text>
          {t(`subTopic.retire.${action}.description`, { count: descendants, title })}
          {running > 0 && ` ${t(`subTopic.retire.${action}.running`, { count: running })}`}
        </Text>
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
): Promise<RetireChoice | null> =>
  new Promise((resolve) => {
    let settled = false;
    const settle = (choice: RetireChoice | null) => {
      if (settled) return;
      settled = true;
      resolve(choice);
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
