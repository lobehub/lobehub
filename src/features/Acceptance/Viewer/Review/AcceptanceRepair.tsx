'use client';

import { Button, createModal, Flexbox, Text, TextArea, useModalContext } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { commentAnchorId } from '../Comments/anchor';
import { acceptanceOverviewPath, useAcceptanceRouteBase } from '../routes';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import RejectFeedbackPreview from './RejectFeedbackPreview';
import { repairPresentation } from './repairPresentation';

const RepairRequestContent = ({
  acceptanceId,
  routeBase,
}: {
  acceptanceId: string;
  routeBase: string;
}) => {
  const { t } = useTranslation('verify');
  const { close } = useModalContext();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const retry = data?.repair?.state === 'failed' ? data.repair : null;
  const commentIds = retry?.commentIds ?? [];
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    setPending(true);
    setError(undefined);
    try {
      const result = await verifyService.requestAcceptanceRepair(
        acceptanceId,
        retry ? retry.comment : comment.trim(),
      );
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
      {retry ? (
        <Flexbox gap={8}>
          <Text>{t('acceptance.repair.retryDescription', { count: commentIds.length })}</Text>
          {retry.comment && <Text>{retry.comment}</Text>}
          {commentIds.map((id, index) => (
            <WorkspaceLink
              key={id}
              to={`${acceptanceOverviewPath(acceptanceId, routeBase)}#${commentAnchorId(id)}`}
              onClick={close}
            >
              {t('acceptance.repair.submittedFeedback', { number: index + 1 })}
            </WorkspaceLink>
          ))}
        </Flexbox>
      ) : (
        <RejectFeedbackPreview acceptanceId={acceptanceId} />
      )}
      {!retry && (
        <TextArea
          aria-label={t('acceptance.repair.instructions')}
          autoSize={{ minRows: 3, maxRows: 6 }}
          maxLength={2000}
          placeholder={t('acceptance.repair.placeholder')}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      )}
      {error && (
        <Flexbox role={'alert'}>
          <AsyncError title={error} variant={'inline'} />
        </Flexbox>
      )}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={pending} onClick={close}>
          {t('acceptance.actions.cancel')}
        </Button>
        <Button loading={pending} type={'primary'} onClick={submit}>
          {t(retry ? 'acceptance.repair.retry' : 'acceptance.repair.start')}
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
          {repair.state === 'failed' ? (
            <AsyncError
              title={`${t('acceptance.repair.failed')}. ${t('acceptance.repair.failureHint')}`}
              variant={'inline'}
            />
          ) : (
            <Text>{t(`acceptance.repair.${repairPresentation(repair)}`)}</Text>
          )}
          {repair.state === 'failed' && repair.error && (
            <details>
              <summary style={{ cursor: 'pointer', paddingBlock: 12 }}>
                {t('report.sections.details')}
              </summary>
              <Text style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }} type={'secondary'}>
                {repair.error}
              </Text>
            </details>
          )}
          <Flexbox horizontal gap={16} style={{ flexWrap: 'wrap' }}>
            {repair.taskId && (
              <WorkspaceLink to={taskDetailPath(repair.taskIdentifier ?? repair.taskId)}>
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
        <Flexbox role={'alert'}>
          <AsyncError
            error={error}
            title={t('acceptance.repair.refreshError')}
            variant={'inline'}
            onRetry={() => void mutate()}
          />
        </Flexbox>
      )}
      {data.canRequestRepair && (site || repair?.state === 'failed') && (
        <Button
          disabled={busy}
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            createModal({
              content: <RepairRequestContent acceptanceId={acceptanceId} routeBase={routeBase} />,
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
