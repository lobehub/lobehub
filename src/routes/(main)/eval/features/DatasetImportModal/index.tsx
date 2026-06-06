'use client';

import { createModal, type ImperativeModalProps, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import DatasetImportContent from './Content';
import DatasetImportFooter from './Footer';

interface CreateOptions {
  datasetId: string;
  onSuccess?: (datasetId: string) => void;
  presetId?: string;
}

export const createDatasetImportModal = ({
  datasetId,
  onSuccess,
  presetId,
}: CreateOptions): ModalInstance => {
  const ref: { instance?: ModalInstance } = {};
  let step: 0 | 1 = 0;
  let canImport = false;
  let importing = false;
  let runImport: () => Promise<void> = async () => {};
  let prev: () => void = () => {};

  const renderFooter = () => {
    if (step === 0) return null;
    return (
      <DatasetImportFooter
        canImport={canImport}
        importing={importing}
        onPrev={prev}
        onImport={async () => {
          importing = true;
          ref.instance?.update({ footer: renderFooter() } as Partial<ImperativeModalProps>);
          try {
            await runImport();
          } finally {
            importing = false;
            ref.instance?.update({ footer: renderFooter() } as Partial<ImperativeModalProps>);
          }
        }}
      />
    );
  };

  ref.instance = createModal({
    content: (
      <DatasetImportContent
        close={() => ref.instance?.close()}
        datasetId={datasetId}
        presetId={presetId}
        setPrev={(fn) => {
          prev = fn;
        }}
        onSuccess={onSuccess}
        onImportReady={(api) => {
          runImport = api.runImport;
        }}
        onStateChange={(next) => {
          if (next.step === step && next.canImport === canImport) return;
          step = next.step;
          canImport = next.canImport;
          ref.instance?.update({ footer: renderFooter() } as Partial<ImperativeModalProps>);
        }}
      />
    ),
    footer: renderFooter(),
    maskClosable: false,
    title: t('dataset.import.title', { ns: 'eval' }),
    width: 720,
  });
  return ref.instance;
};
