'use client';

import { Alert, Button, createModal, Flexbox, Text, TextArea, useModalContext } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { acceptanceOverviewPath, useAcceptanceRouteBase } from '../routes';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import RejectFeedbackPreview from './RejectFeedbackPreview';
import { repairPresentation } from './repairPresentation';

const RepairRequestContent = ({ acceptanceId }: { acceptanceId: string }) => {
  const { t } = useTranslation('verify');
  const { close } = useModalContext();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setPending(true);
    setError(undefined);
    try {
      const result = await verifyService.requestAcceptanceRepair(acceptanceId, comment.trim());
      await mutate();
      if (!result.dispatched && result.reason !== 'in_progress') {
        setError(t('acceptance.repair.startError'));
        return;
      }
      close();
    } catch (cause) {
      console.error('[acceptance:repair]', cause);
      setError(t('acceptance.repair.startError'));
    } finally {
      setPending(false);
    }
  };
  return (
    <Flexbox gap={16}>
      <Text>
        {t(
          data?.origin?.topic || data?.collaboration
            ? 'acceptance.repair.originDescription'
            : 'acceptance.repair.description',
        )}
      </Text>
      <RejectFeedbackPreview acceptanceId={acceptanceId} />
      <TextArea
        aria-label={t('acceptance.repair.instructions')}
        autoSize={{ minRows: 3, maxRows: 6 }}
        maxLength={2000}
        placeholder={t('acceptance.repair.placeholder')}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      {error && <Alert title={error} type={'error'} />}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={pending} onClick={close}>
          {t('acceptance.actions.cancel')}
        </Button>
        <Button loading={pending} type={'primary'} onClick={submit}>
          {t('acceptance.repair.start')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/** Handoff and progress belong to the review, including its discussion tab. */
export const AcceptanceRepair = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const routeBase = useAcceptanceRouteBase();
  const { data, error, mutate } = useAcceptanceBundle(acceptanceId);
  if (!data) return null;
  const { repair, repairSource } = data;
  const site = data.acceptance.subjectType === 'site';
  const busy = repair?.state === 'starting' || repair?.state === 'running';
  if (!repair && !repairSource && !(site && data.canRequestRepair)) return null;
  return (
    <Flexbox gap={8}>
      {repairSource && (
        <WorkspaceLink to={acceptanceOverviewPath(repairSource.acceptanceId, routeBase)}>
          {t('acceptance.repair.source')}
        </WorkspaceLink>
      )}
      {repair && (
        <Flexbox gap={8} role={'status'}>
          <Text>{t(`acceptance.repair.${repairPresentation(repair)}`)}</Text>
          {repair.state === 'failed' && (
            <Text type={'secondary'}>{repair.error ?? t('acceptance.repair.failureHint')}</Text>
          )}
          <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
            {repair.taskId && (
              <WorkspaceLink to={taskDetailPath(repair.taskId)}>
                {t('acceptance.repair.openTask')}
              </WorkspaceLink>
            )}
            {repair.deliveryAcceptanceId && (
              <WorkspaceLink to={acceptanceOverviewPath(repair.deliveryAcceptanceId, routeBase)}>
                {t('acceptance.repair.openDelivery')}
              </WorkspaceLink>
            )}
            {repair.previewUrl && (
              <a href={repair.previewUrl} rel={'noopener noreferrer'} target={'_blank'}>
                {t('acceptance.repair.openPreview')}
              </a>
            )}
          </Flexbox>
        </Flexbox>
      )}
      {Boolean(error) && (
        <Alert
          action={<Button onClick={() => void mutate()}>{t('report.actions.retry')}</Button>}
          title={t('acceptance.repair.refreshError')}
          type={'warning'}
        />
      )}
      {data.canRequestRepair && (site || repair?.state === 'failed') && (
        <Button
          disabled={busy}
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            createModal({
              content: <RepairRequestContent acceptanceId={acceptanceId} />,
              footer: null,
              title: t('acceptance.repair.start'),
              width: 'min(90vw, 520px)',
            })
          }
        >
          {t(repair?.state === 'failed' ? 'acceptance.repair.retry' : 'acceptance.repair.start')}
        </Button>
      )}
    </Flexbox>
  );
};
