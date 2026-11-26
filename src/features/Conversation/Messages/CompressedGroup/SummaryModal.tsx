'use client';

import { Button, createModal, Flexbox, Icon, Markdown } from '@lobehub/ui';
import { t } from 'i18next';
import { Undo2 } from 'lucide-react';

interface OpenCompressionSummaryParams {
  content?: string;
  /** Asks for confirmation itself; the summary closes once it is confirmed. */
  onCancelCompression: (onDone: () => void) => void;
}

/**
 * The summary opens over the conversation rather than inside it, so reading it
 * neither grows the list nor hides under the chat input.
 */
export const openCompressionSummary = ({
  content,
  onCancelCompression,
}: OpenCompressionSummaryParams) => {
  const modal = createModal({
    content: <Markdown variant={'chat'}>{content ?? ''}</Markdown>,
    footer: (
      <Flexbox horizontal justify={'flex-end'}>
        <Button
          icon={<Icon icon={Undo2} />}
          onClick={() => onCancelCompression(() => modal.close())}
        >
          {t('compression.cancel', { ns: 'chat' })}
        </Button>
      </Flexbox>
    ),
    maskClosable: true,
    title: t('compression.summary', { ns: 'chat' }),
    width: 'min(90%, 720px)',
  });

  return modal;
};
