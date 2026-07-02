'use client';

import type { VerifyRunStatus, VerifyVerdict } from '@lobechat/types';
import { Block, Center, Empty, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileClock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import type { VerifyReportSummary } from '@/services/verify';

import { useRubrics, useVerifyReportSummaries } from './hooks';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};

    transition:
      border-color 0.16s ease,
      background 0.16s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  container: css`
    overflow: auto;
    width: 100%;
    height: 100%;
  `,
  content: css`
    width: min(100%, 960px);
    margin-inline: auto;
    padding-block: 28px;
    padding-inline: 24px;
  `,
  meta: css`
    color: ${cssVar.colorTextTertiary};
  `,
  stat: css`
    font-size: 17px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  `,
  summary: css`
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  templateCard: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};
  `,
  templateGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
    gap: 8px;
  `,
  title: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const verdictMeta: Record<
  VerifyVerdict,
  { color: string; icon: typeof Check; key: 'failed' | 'passed' | 'uncertain' }
> = {
  failed: { color: 'error', icon: X, key: 'failed' },
  passed: { color: 'success', icon: Check, key: 'passed' },
  uncertain: { color: 'warning', icon: CircleHelp, key: 'uncertain' },
};

const statusColor: Record<VerifyRunStatus, string> = {
  delivered: 'success',
  failed: 'error',
  passed: 'success',
  planned: 'processing',
  repairing: 'warning',
  unverified: 'default',
  verifying: 'processing',
};

const terminalStatuses = new Set<VerifyRunStatus>(['delivered', 'failed', 'passed']);

const reportStatusLabelKey: Record<VerifyRunStatus, `reports.status.${VerifyRunStatus}`> = {
  delivered: 'reports.status.delivered',
  failed: 'reports.status.failed',
  passed: 'reports.status.passed',
  planned: 'reports.status.planned',
  repairing: 'reports.status.repairing',
  unverified: 'reports.status.unverified',
  verifying: 'reports.status.verifying',
};

const formatDate = (value?: Date | string | null) => {
  if (!value) return '';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const ReportVerdict = memo<{ verdict?: VerifyVerdict | null }>(({ verdict }) => {
  const { t } = useTranslation('verify');
  if (!verdict) return <Tag>{t('reports.verdict.pending')}</Tag>;

  const meta = verdictMeta[verdict];
  return (
    <Tag color={meta.color} icon={<Icon icon={meta.icon} />}>
      {t(`reports.verdict.${meta.key}`)}
    </Tag>
  );
});

ReportVerdict.displayName = 'ReportVerdict';

const ReportStatus = memo<{ status?: VerifyRunStatus | null }>(({ status }) => {
  const { t } = useTranslation('verify');
  const value = status ?? 'unverified';

  return <Tag color={statusColor[value]}>{t(reportStatusLabelKey[value])}</Tag>;
});

ReportStatus.displayName = 'ReportStatus';

const ReportStats = memo<{ item: VerifyReportSummary }>(({ item }) => {
  const { t } = useTranslation('verify');
  const planCount = Array.isArray(item.run.plan) ? item.run.plan.length : 0;
  const total = item.report?.totalChecks ?? planCount;
  const passed = item.report?.passedChecks ?? 0;
  const failed = item.report?.failedChecks ?? 0;
  const uncertain = item.report?.uncertainChecks ?? Math.max(total - passed - failed, 0);
  const stats = [
    { key: 'total', value: total },
    { key: 'passed', value: passed },
    { key: 'failed', value: failed },
    { key: 'uncertain', value: uncertain },
  ] as const;

  return (
    <Flexbox horizontal align={'center'} gap={18} wrap={'wrap'}>
      {stats.map(({ key, value }) => (
        <Flexbox gap={3} key={key}>
          <span className={styles.stat}>{value}</span>
          <Text className={styles.meta} fontSize={12}>
            {t(`reports.stats.${key}`)}
          </Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

ReportStats.displayName = 'ReportStats';

const ReportRow = memo<{ item: VerifyReportSummary }>(({ item }) => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const title = item.run.title || t('reports.untitled');
  const createdAt = formatDate(item.report?.generatedAt ?? item.run.createdAt);
  const summary = item.report?.summary || item.run.goal || t('reports.noSummary');
  const status = item.run.status ?? 'unverified';
  const isOpenable = Boolean(item.report) || terminalStatuses.has(status);

  return (
    <Block
      clickable
      className={styles.card}
      gap={12}
      role={'button'}
      tabIndex={0}
      onClick={() => navigate(`/verify/${item.run.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') navigate(`/verify/${item.run.id}`);
      }}
    >
      <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
        <Flexbox gap={6} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Text strong className={styles.title} fontSize={15}>
              {title}
            </Text>
            <ReportVerdict verdict={item.report?.verdict} />
            <ReportStatus status={item.run.status} />
          </Flexbox>
          <Text className={styles.summary} type={'secondary'}>
            {summary}
          </Text>
        </Flexbox>
        <Icon className={styles.meta} icon={ChevronRight} size={18} />
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
        <ReportStats item={item} />
        <Flexbox horizontal align={'center'} className={styles.meta} gap={6}>
          <Icon icon={isOpenable ? ClipboardCheck : FileClock} size={14} />
          <Text className={styles.meta} fontSize={12}>
            {createdAt || t('reports.dateUnknown')}
          </Text>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

ReportRow.displayName = 'ReportRow';

const TemplateShelf = memo(() => {
  const { t } = useTranslation('verify');
  const { data: rubrics, isLoading } = useRubrics();
  const templates = rubrics ?? [];

  if (isLoading && templates.length === 0) return null;

  return (
    <Flexbox gap={10}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon icon={ShieldCheck} size={17} />
        <Text strong>{t('templates.title')}</Text>
        <Tag>{t('templates.count', { count: templates.length })}</Tag>
      </Flexbox>
      <Text type={'secondary'}>{t('templates.subtitle')}</Text>
      {templates.length === 0 ? (
        <Text className={styles.meta}>{t('templates.empty')}</Text>
      ) : (
        <div className={styles.templateGrid}>
          {templates.slice(0, 6).map((template) => (
            <Flexbox className={styles.templateCard} gap={4} key={template.id}>
              <Text ellipsis strong>
                {template.title}
              </Text>
              {template.description ? (
                <Text className={styles.summary} fontSize={12} type={'secondary'}>
                  {template.description}
                </Text>
              ) : (
                <Text className={styles.meta} fontSize={12}>
                  {t('templates.savedTemplate')}
                </Text>
              )}
            </Flexbox>
          ))}
        </div>
      )}
    </Flexbox>
  );
});

TemplateShelf.displayName = 'TemplateShelf';

const VerifyReportsPage = memo(() => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const { data, error, isLoading, mutate } = useVerifyReportSummaries();
  const reports = useMemo(() => data ?? [], [data]);

  if (isLoading && !data) {
    return (
      <Center height={'100%'} width={'100%'}>
        <Loading debugId="verify-reports" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center gap={16} height={'100%'} width={'100%'}>
        <Empty
          description={t('reports.error.description')}
          icon={X}
          title={t('reports.error.title')}
        />
        <Button icon={RefreshCw} onClick={() => void mutate()}>
          {t('reports.actions.retry')}
        </Button>
      </Center>
    );
  }

  return (
    <div className={styles.container}>
      <Flexbox className={styles.content} gap={20}>
        <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'} wrap={'wrap'}>
          <Flexbox gap={6}>
            <Text as={'h2'}>{t('reports.title')}</Text>
            <Text type={'secondary'}>{t('reports.subtitle')}</Text>
          </Flexbox>
          <Button icon={RefreshCw} size={'small'} onClick={() => void mutate()}>
            {t('reports.actions.refresh')}
          </Button>
        </Flexbox>

        <TemplateShelf />

        {reports.length === 0 ? (
          <Center gap={16} style={{ minHeight: '50vh' }} width={'100%'}>
            <Empty
              description={t('reports.empty.description')}
              icon={ClipboardCheck}
              title={t('reports.empty.title')}
            />
            <Button icon={ClipboardCheck} type={'primary'} onClick={() => navigate('/tasks')}>
              {t('reports.empty.action')}
            </Button>
          </Center>
        ) : (
          <Flexbox gap={10}>
            {reports.map((item) => (
              <ReportRow item={item} key={item.run.id} />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </div>
  );
});

VerifyReportsPage.displayName = 'VerifyReportsPage';

export default VerifyReportsPage;
