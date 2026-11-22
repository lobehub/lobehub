import { Button, createModal, Flexbox, Text, useModalContext } from '@lobehub/ui';
import type { ReactNode } from 'react';

interface ConfirmInviteOptions {
  cancelText: string;
  content: ReactNode;
  okText: string;
  title: string;
}

const ConfirmBody = ({
  cancelText,
  content,
  okText,
  onConfirm,
}: Omit<ConfirmInviteOptions, 'title'> & { onConfirm: () => void }) => {
  const { close } = useModalContext();
  return (
    <Flexbox gap={16}>
      <Text type="secondary">{content}</Text>
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button onClick={close}>{cancelText}</Button>
        <Button
          autoFocus
          type="primary"
          onClick={() => {
            onConfirm();
            close();
          }}
        >
          {okText}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/**
 * Asks before someone outside the Channel is brought in. Resolves false however the dialog
 * closes without confirming (Cancel, ✕, Esc or the mask), so a waiting send never hangs. Cancel
 * closes through the modal context, which does not report `onOpenChange`; the close completing
 * does, whatever closed it.
 */
export const confirmInvite = ({ title, ...body }: ConfirmInviteOptions) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    };
    createModal({
      content: <ConfirmBody {...body} onConfirm={() => settle(true)} />,
      footer: null,
      title,
      width: 420,
      onOpenChange: (open) => {
        if (!open) settle(false);
      },
      onOpenChangeComplete: (open) => {
        if (!open) settle(false);
      },
    });
  });
