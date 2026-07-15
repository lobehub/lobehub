'use client';

import { Center, Empty, Flexbox, Icon, Markdown, Tag, Text, TextArea } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, ChevronRight, CircleAlert, Clock3, GitBranch, X } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { verifyService } from '@/services/verify';

import { useAcceptanceBundle } from './hooks';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: auto;
    height: 100%;
    padding: 24px;
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  check: css`
    padding-block: 14px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  decision: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  history: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  round: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    color: inherit;
    text-decoration: none;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

const stateIcon = (state: string) => {
  if (state === 'passed') return <Icon color={cssVar.colorSuccess} icon={Check} />;
  if (state === 'failed') return <Icon color={cssVar.colorError} icon={X} />;
  if (state === 'uncertain') return <Icon color={cssVar.colorWarning} icon={CircleAlert} />;
  return <Icon color={cssVar.colorTextTertiary} icon={Clock3} />;
};

const AcceptanceViewer = memo(() => {
  const { acceptanceId } = useParams<{ acceptanceId: string }>();
  const { t } = useTranslation('verify');
  const { data, error, isLoading, mutate } = useAcceptanceBundle(acceptanceId ?? null);
  const [actionError, setActionError] = useState<string>();

  const exceptionCount = useMemo(
    () => data?.checks.filter((check) => check.state !== 'passed').length ?? 0,
    [data],
  );

  if (isLoading) {
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading size={48} />
      </Center>
    );
  }

  if (error || !data) {
    return (
      <Center height={'100%'}>
        <Empty description={t('acceptance.error.description')} title={t('acceptance.error.title')}>
          <Button onClick={() => void mutate()}>{t('report.actions.retry')}</Button>
        </Empty>
      </Center>
    );
  }

  const { acceptance, checks, latestReport, rounds, subject } = data;
  const isAccepted = acceptance.status === 'accepted';

  const accept = () => {
    confirmModal({
      cancelText: t('acceptance.actions.cancel'),
      content: t('acceptance.accept.description', { count: exceptionCount }),
      okText: t('acceptance.actions.confirmAccept'),
      onOk: async () => {
        try {
          setActionError(undefined);
          await verifyService.acceptDelivery(acceptance.id);
          await mutate();
        } catch (cause) {
          setActionError(cause instanceof Error ? cause.message : t('acceptance.actionError'));
          throw cause;
        }
      },
      title: t('acceptance.actions.accept'),
    });
  };

  const reject = () => {
    let comment = '';
    confirmModal({
      cancelText: t('acceptance.actions.cancel'),
      content: (
        <Flexbox gap={12}>
          <Text type={'secondary'}>{t('acceptance.reject.description')}</Text>
          <TextArea
            autoSize={{ maxRows: 6, minRows: 3 }}
            placeholder={t('acceptance.reject.placeholder')}
            onChange={(event) => {
              comment = event.target.value;
            }}
          />
        </Flexbox>
      ),
      okText: t('acceptance.actions.confirmReject'),
      onOk: async () => {
        if (!comment.trim()) throw new Error(t('acceptance.reject.required'));
        try {
          setActionError(undefined);
          await verifyService.rejectDelivery(acceptance.id, comment.trim());
          await mutate();
        } catch (cause) {
          setActionError(cause instanceof Error ? cause.message : t('acceptance.actionError'));
          throw cause;
        }
      },
      title: t('acceptance.actions.reject'),
    });
  };

  return (
    <div className={styles.body}>
      <Flexbox gap={20} style={{ margin: '0 auto', maxWidth: 920 }}>
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text as={'h1'} style={{ fontSize: 20, margin: 0 }}>
              {subject.title ?? subject.id}
            </Text>
            <Tag>{t(`acceptance.subject.${subject.type}`)}</Tag>
          </Flexbox>
          {acceptance.requirement && <Text type={'secondary'}>{acceptance.requirement}</Text>}
          <Flexbox horizontal align={'center'} gap={6}>
            <Icon icon={GitBranch} size={14} />
            <Text type={'secondary'}>{t('acceptance.roundCount', { count: rounds.length })}</Text>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align={'center'} className={styles.decision} gap={16}>
          <Flexbox flex={1} gap={4}>
            <Text strong>{t(`acceptance.status.${acceptance.status}`)}</Text>
            <Text type={'secondary'}>
              {t('acceptance.exceptionCount', { count: exceptionCount })}
            </Text>
            {actionError && <Text type={'danger'}>{actionError}</Text>}
          </Flexbox>
          {!isAccepted && (
            <>
              <Button onClick={reject}>{t('acceptance.actions.reject')}</Button>
              <Button type={'primary'} onClick={accept}>
                {t('acceptance.actions.accept')}
              </Button>
            </>
          )}
        </Flexbox>

        {latestReport?.summary && (
          <Flexbox className={styles.card} gap={8} padding={16}>
            <Text strong>{t('acceptance.latestSummary')}</Text>
            <Markdown>{latestReport.summary}</Markdown>
          </Flexbox>
        )}

        <Flexbox gap={8}>
          <Text strong>{t('acceptance.checks.title')}</Text>
          <div className={styles.card}>
            {checks.map((check) => (
              <Flexbox className={styles.check} gap={8} key={check.id}>
                <Flexbox horizontal align={'center'} gap={10}>
                  {stateIcon(check.state)}
                  <Text strong>{check.title}</Text>
                  {check.required && <Tag>{t('acceptance.checks.gate')}</Tag>}
                  {check.fixed && <Tag color={'green'}>{t('acceptance.checks.fixed')}</Tag>}
                </Flexbox>
                <div className={styles.history}>
                  {check.history
                    .map((item) => {
                      const verdictKey = item.state === 'not_executed' ? 'notExecuted' : item.state;
                      return `${t('acceptance.roundShort', { round: item.roundIndex })}: ${t(`report.verdict.${verdictKey}`)}`;
                    })
                    .join(' → ')}
                </div>
              </Flexbox>
            ))}
          </div>
        </Flexbox>

        <Flexbox gap={8}>
          <Text strong>{t('acceptance.rounds.title')}</Text>
          <div className={styles.card}>
            {rounds.map(({ report, run }) => (
              <Link className={styles.round} key={run.id} to={`/verify/${run.id}`}>
                <Flexbox horizontal align={'center'} gap={12}>
                  <Flexbox flex={1} gap={2}>
                    <Text strong>{t('acceptance.round', { round: run.roundIndex })}</Text>
                    <Text type={'secondary'}>{report?.summary ?? t('reports.noSummary')}</Text>
                  </Flexbox>
                  {report?.verdict && <Tag>{t(`report.verdict.${report.verdict}`)}</Tag>}
                  <Icon icon={ChevronRight} />
                </Flexbox>
              </Link>
            ))}
          </div>
        </Flexbox>
      </Flexbox>
    </div>
  );
});

AcceptanceViewer.displayName = 'AcceptanceViewer';

export default AcceptanceViewer;
