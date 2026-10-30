'use client';

import { Button, createModal, Flexbox, Highlighter, Text } from '@lobehub/ui';
import { t } from 'i18next';
import type { ReactNode } from 'react';

interface ConfirmOptions {
  cancelText: string;
  content: ReactNode;
  okText: string;
  /** Aborted when the view goes away: drops the request, or closes its modal if shown */
  signal?: AbortSignal;
  title: string;
}

// Requests from every view on the page share one queue, so modals open one at a time
let queue: Promise<unknown> = Promise.resolve();

const openModal = ({ cancelText, content, okText, signal, title }: ConfirmOptions) =>
  new Promise<boolean>((resolve) => {
    if (signal?.aborted) return resolve(false);

    let settled = false;
    const settle = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(allowed);
      modal.close();
    };
    const onAbort = () => settle(false);
    signal?.addEventListener('abort', onAbort, { once: true });
    const modal = createModal({
      content,
      footer: (
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button onClick={() => settle(false)}>{cancelText}</Button>
          <Button type={'primary'} onClick={() => settle(true)}>
            {okText}
          </Button>
        </Flexbox>
      ),
      onOpenChange: (open) => {
        if (!open) settle(false);
      },
      title,
    });
  });

/**
 * Resolves false on Cancel and on any other dismissal (Esc, mask, close), and
 * at once when `signal` aborts, even while waiting behind another modal.
 */
const confirm = (options: ConfirmOptions) => {
  const turn = queue.then(() => openModal(options));
  // A modal that failed to open must not block the ones after it
  queue = turn.catch(() => {});

  const { signal } = options;
  if (!signal) return turn;
  if (signal.aborted) return Promise.resolve(false);

  // Not `Promise.withResolvers`, which Safari < 17.4 and Chrome < 119 lack
  let onAbort = () => {};
  const dropped = new Promise<boolean>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  // The signal can outlive many requests, so don't leave a listener per answer
  return Promise.race([turn, dropped]).finally(() => signal.removeEventListener('abort', onAbort));
};

/** Ask before a view runs a tool, showing the app by name and the arguments it passes. */
export const confirmAppToolCall = ({
  appName,
  args,
  signal,
  tool,
}: {
  appName: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  tool: string;
}) =>
  confirm({
    cancelText: t('mcpApp.toolCall.confirm.cancel', { ns: 'plugin' }),
    content: (
      <Flexbox gap={12}>
        <Text>{t('mcpApp.toolCall.confirm.content', { app: appName, ns: 'plugin', tool })}</Text>
        <Highlighter actionIconSize={'small'} language={'json'} wrap={true}>
          {JSON.stringify(args, null, 2)}
        </Highlighter>
      </Flexbox>
    ),
    okText: t('mcpApp.toolCall.confirm.ok', { ns: 'plugin' }),
    signal,
    title: t('mcpApp.toolCall.confirm.title', { ns: 'plugin' }),
  });

/** Ask before a view posts a message the user did not just send from it. */
export const confirmAppMessage = ({
  appName,
  signal,
  text,
}: {
  appName: string;
  signal?: AbortSignal;
  text: string;
}) =>
  confirm({
    cancelText: t('mcpApp.message.confirm.cancel', { ns: 'plugin' }),
    content: (
      <Flexbox gap={12}>
        <Text>{t('mcpApp.message.confirm.content', { app: appName, ns: 'plugin' })}</Text>
        <Highlighter actionIconSize={'small'} language={'markdown'} wrap={true}>
          {text}
        </Highlighter>
      </Flexbox>
    ),
    okText: t('mcpApp.message.confirm.ok', { ns: 'plugin' }),
    signal,
    title: t('mcpApp.message.confirm.title', { ns: 'plugin' }),
  });
