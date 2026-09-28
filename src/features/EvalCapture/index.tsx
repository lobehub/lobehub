'use client';

import {
  Button,
  createModal,
  type ImperativeModalProps,
  ModalFooter,
  type ModalInstance,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { type CaptureDraft } from './buildCaptureDraft';
import CaptureContent from './CaptureContent';
import CaptureSuccess from './CaptureSuccess';

export { buildCaptureDraft, type CaptureDraft } from './buildCaptureDraft';

let formIdSeed = 0;

export interface CreateEvalCaptureModalOptions {
  draft: CaptureDraft;
  /** Navigate to the saved case. Saving and inspecting are separate intents. */
  onView: (testCaseId: string) => void;
}

/**
 * Capture a conversation turn as an eval case.
 *
 * Two phases in one modal: the form, then a confirmation offering to inspect
 * the case or to stop. Saving does not navigate on its own — a comparison run
 * costs money and is rarely wanted in the same breath as filing the case.
 */
export const createEvalCaptureModal = ({
  draft,
  onView,
}: CreateEvalCaptureModalOptions): ModalInstance => {
  const formId = `eval-capture-${formIdSeed++}`;
  const ref: { instance?: ModalInstance } = {};

  // `createModal` renders `footer` verbatim — it supplies no chrome of its own,
  // so the padding and alignment have to come from `ModalFooter`. Without it the
  // buttons sit flush against the modal's rounded corner.
  const formFooter = (loading: boolean) => (
    <ModalFooter>
      <Button onClick={() => ref.instance?.close()}>{t('common:cancel')}</Button>
      <Button form={formId} htmlType="submit" loading={loading} type="primary">
        {t('capture.save', { ns: 'eval' })}
      </Button>
    </ModalFooter>
  );

  const setLoading = (loading: boolean) =>
    ref.instance?.update({ footer: formFooter(loading) } as Partial<ImperativeModalProps>);

  const onSaved = (testCaseId: string, datasetName: string) =>
    ref.instance?.update({
      content: <CaptureSuccess datasetName={datasetName} />,
      footer: (
        <ModalFooter>
          <Button onClick={() => ref.instance?.close()}>{t('capture.done', { ns: 'eval' })}</Button>
          <Button
            type="primary"
            onClick={() => {
              ref.instance?.close();
              onView(testCaseId);
            }}
          >
            {t('capture.view', { ns: 'eval' })}
          </Button>
        </ModalFooter>
      ),
      width: 460,
    } as Partial<ImperativeModalProps>);

  ref.instance = createModal({
    content: (
      <CaptureContent
        draft={draft}
        formId={formId}
        onLoadingChange={setLoading}
        onSaved={onSaved}
      />
    ),
    footer: formFooter(false),
    title: t('capture.title', { ns: 'eval' }),
    width: 1040,
  });

  return ref.instance;
};
