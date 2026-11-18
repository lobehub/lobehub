'use client';

import { Button, createModal, Flexbox, Input, Text, toast, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DraftGitSendPrompts } from './prepareSend';

/**
 * Open a modal whose content settles a promise; dismissing it any other way
 * (Esc, backdrop, ✕) settles it with `fallback`.
 */
const ask = <T,>(
  title: ReactNode,
  render: (settle: (value: T) => void) => ReactNode,
  fallback: T,
): Promise<T> =>
  new Promise<T>((resolve) => {
    let settled = false;
    const settle = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    createModal({
      content: render(settle),
      footer: null,
      maskClosable: true,
      onOpenChangeComplete: (open) => {
        if (!open) settle(fallback);
      },
      styles: { header: { borderBottom: 'none' } },
      title,
      width: 'min(90vw, 480px)',
    });
  });

interface BranchNameContentProps {
  branch: string;
  defaultName: string;
  holder: string;
  onDone: (name: string | undefined) => void;
}

const BranchNameContent = ({ branch, defaultName, holder, onDone }: BranchNameContentProps) => {
  const { t: tDevice } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const [value, setValue] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.select());
  }, []);

  const finish = (name: string | undefined) => {
    onDone(name);
    close();
  };
  const submit = () => {
    const name = value.trim();
    if (name) finish(name);
  };

  return (
    <Flexbox gap={16}>
      <Text type={'secondary'}>
        {tDevice('workingDirectory.occupiedBranchDesc', { branch, name: holder })}
      </Text>
      <Flexbox gap={6}>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {tDevice('workingDirectory.occupiedBranchNameLabel')}
        </Text>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={submit}
        />
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={() => finish(undefined)}>{tCommon('cancel')}</Button>
        <Button disabled={!value.trim()} type={'primary'} onClick={submit}>
          {tDevice('workingDirectory.occupiedBranchConfirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

interface SwitchRiskContentProps {
  onDone: (confirmed: boolean) => void;
  running: number;
  uncommitted: number;
}

const SwitchRiskContent = ({ onDone, running, uncommitted }: SwitchRiskContentProps) => {
  const { t: tDevice } = useTranslation('device');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();

  const finish = (confirmed: boolean) => {
    onDone(confirmed);
    close();
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        {uncommitted > 0 && (
          <Text>{tDevice('workingDirectory.switchRiskUncommitted', { count: uncommitted })}</Text>
        )}
        {running > 0 && (
          <Text>{tDevice('workingDirectory.switchRiskRunning', { count: running })}</Text>
        )}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={() => finish(false)}>{tCommon('cancel')}</Button>
        <Button danger={uncommitted > 0} type={'primary'} onClick={() => finish(true)}>
          {tDevice('workingDirectory.switchRiskConfirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/** The send-time prompts, as modals and toasts. */
export const draftGitSendPrompts: DraftGitSendPrompts = {
  askBranchName: ({ branch, defaultName, holder }) =>
    ask<string | undefined>(
      t('workingDirectory.occupiedBranchTitle', { branch, ns: 'device' }),
      (settle) => (
        <BranchNameContent
          branch={branch}
          defaultName={defaultName}
          holder={holder}
          onDone={settle}
        />
      ),
      undefined,
    ),
  confirmSwitchRisks: ({ branch, running, uncommitted }) =>
    ask<boolean>(
      t('workingDirectory.switchRiskTitle', { branch, ns: 'device' }),
      (settle) => <SwitchRiskContent running={running} uncommitted={uncommitted} onDone={settle} />,
      false,
    ),
  notifyError: ({ description, title }) => {
    toast.error({ description, title });
  },
  showProgress: (label) => {
    const instance = toast.loading(label);
    return () => instance.close();
  },
};
