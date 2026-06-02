'use client';

import { createModal, type ImperativeModalProps, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import RunCreateContent, { type RunCreateContentProps } from './Content';
import RunCreateFooter from './Footer';

type Props = Omit<RunCreateContentProps, 'onLoadingChange' | 'onSubmitReady'>;

export const createRunCreateModal = (props: Props): ModalInstance => {
  const ref: { instance?: ModalInstance } = {};
  let submit: (shouldStart: boolean) => Promise<void> = async () => {};
  let loading = false;

  const renderFooter = () => (
    <RunCreateFooter
      loading={loading}
      onCreateAndStart={() => submit(true)}
      onCreateOnly={() => submit(false)}
    />
  );

  const setLoading = (next: boolean) => {
    loading = next;
    ref.instance?.update({ footer: renderFooter() } as Partial<ImperativeModalProps>);
  };

  ref.instance = createModal({
    content: (
      <RunCreateContent
        {...props}
        onLoadingChange={setLoading}
        onSubmitReady={(s) => {
          submit = s;
        }}
      />
    ),
    footer: renderFooter(),
    title:
      props.datasetId && props.datasetName
        ? t('run.create.titleWithDataset', { dataset: props.datasetName, ns: 'eval' })
        : t('run.create.title', { ns: 'eval' }),
    width: 520,
  });
  return ref.instance;
};
