'use client';

import { createModal, type ImperativeModalProps, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import BatchResumeContent from './Content';
import BatchResumeFooter from './Footer';

interface CreateOptions {
  onConfirm: (targets: Array<{ testCaseId: string; threadId?: string }>) => Promise<void>;
  runId: string;
}

export const createBatchResumeModal = ({ onConfirm, runId }: CreateOptions): ModalInstance => {
  const ref: { instance?: ModalInstance } = {};
  let confirming = false;
  let selectedCount = 0;
  let runConfirm: () => Promise<void> = async () => {};

  const renderFooter = () => (
    <BatchResumeFooter
      confirming={confirming}
      selectedCount={selectedCount}
      onConfirm={async () => {
        confirming = true;
        ref.instance?.update({ footer: renderFooter() } as Partial<ImperativeModalProps>);
        try {
          await runConfirm();
          ref.instance?.close();
        } finally {
          confirming = false;
          ref.instance?.update({ footer: renderFooter() } as Partial<ImperativeModalProps>);
        }
      }}
    />
  );

  const onSelectionChange = (count: number) => {
    if (count === selectedCount) return;
    selectedCount = count;
    ref.instance?.update({ footer: renderFooter() } as Partial<ImperativeModalProps>);
  };

  ref.instance = createModal({
    content: (
      <BatchResumeContent
        runId={runId}
        submitter={onConfirm}
        onSelectionChange={onSelectionChange}
        onSelectionReady={(api) => {
          runConfirm = api.confirm;
        }}
      />
    ),
    footer: renderFooter(),
    title: t('run.actions.batchResume.modal.title', { ns: 'eval' }),
    width: 700,
  });
  return ref.instance;
};
