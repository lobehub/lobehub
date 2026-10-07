'use client';

import {
  Button,
  createModal,
  type ImperativeModalProps,
  ModalFooter,
  type ModalInstance,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import CompareContent, { type CompareContentProps } from './Content';

let formIdSeed = 0;

export type CreateCompareModalOptions = Omit<
  CompareContentProps,
  'formId' | 'onLoadingChange' | 'onStarted'
> & {
  /** Called with the new comparison run once it has been dispatched. */
  onStarted: (runId: string) => void;
};

/**
 * Re-issue frozen cases against several models. Starting costs money, so it is
 * always an explicit step; the comparison page is where results land.
 */
export const createCompareModal = ({
  onStarted,
  ...props
}: CreateCompareModalOptions): ModalInstance => {
  const formId = `eval-compare-${formIdSeed++}`;
  const ref: { instance?: ModalInstance } = {};

  const footer = (loading: boolean) => (
    <ModalFooter>
      <Button onClick={() => ref.instance?.close()}>{t('common:cancel')}</Button>
      <Button form={formId} htmlType="submit" loading={loading} type="primary">
        {t('compareModal.start', { ns: 'eval' })}
      </Button>
    </ModalFooter>
  );

  ref.instance = createModal({
    content: (
      <CompareContent
        {...props}
        formId={formId}
        onLoadingChange={(loading) =>
          ref.instance?.update({ footer: footer(loading) } as Partial<ImperativeModalProps>)
        }
        onStarted={(runId) => {
          ref.instance?.close();
          onStarted(runId);
        }}
      />
    ),
    footer: footer(false),
    title: t('compareModal.title', { ns: 'eval' }),
    width: 560,
  });

  return ref.instance;
};
