import { Alert, Block, Button, Drawer, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { type CaseAttempt, formatCost } from './caseResults';
import { verdictStyle } from './ExperimentCaseRow';

const styles = stylex.create({
  attempt: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 6,
    fontSize: 12,
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontVariantNumeric: 'tabular-nums' },
});

interface CaseDetail {
  attempt: CaseAttempt;
  id: string;
  name: string;
  traceUrl?: string;
  unavailable: boolean;
}

/** Shows scoring diagnostics separately from the retained candidate answer and trace. */
export const ExperimentCaseDetails = ({
  onClose,
  results,
  subtitle,
  title,
}: {
  onClose: () => void;
  results: CaseDetail[];
  subtitle: string;
  title?: string;
}) => {
  const { t } = useTranslation('eval');
  return (
    <Drawer open={title !== undefined} title={title ?? ''} width={640} onClose={onClose}>
      <Flexbox gap={16}>
        <Text fontSize={12} type={'secondary'}>
          {subtitle}
        </Text>
        {results.map(({ attempt: a, id, name, traceUrl, unavailable }) => (
          <Block key={id} padding={12} variant={'outlined'}>
            <Flexbox gap={8}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
                <Text weight={500}>{name}</Text>
                {!unavailable && (
                  <Flexbox horizontal align={'center'} gap={4} wrap={'wrap'}>
                    {a.threads.map((thread, index) => (
                      <span
                        className={stylex.props(styles.attempt).className}
                        key={index}
                        style={verdictStyle(thread.status)}
                        title={`${t('lobeBench.compare.attempt', { n: index + 1 })}${thread.status === 'judge_error' ? ` · ${t('lobeBench.compare.judgeError')}` : ''}`}
                      >
                        {thread.status === 'passed'
                          ? '✓'
                          : thread.status === 'failed'
                            ? '✗'
                            : ['error', 'timeout', 'judge_error'].includes(thread.status)
                              ? '!'
                              : '…'}
                      </span>
                    ))}
                    <Text
                      className={stylex.props(styles.mono).className}
                      fontSize={12}
                      type={'secondary'}
                    >
                      {a.verdict === 'judge_error'
                        ? t('lobeBench.compare.judgeError')
                        : ['error', 'timeout'].includes(a.verdict)
                          ? t('lobeBench.compare.error')
                          : ['pending', 'running'].includes(a.verdict)
                            ? t('lobeBench.compare.pending')
                            : t('lobeBench.compare.passes', {
                                passed: a.passCount,
                                total: a.total,
                              })}
                    </Text>
                  </Flexbox>
                )}
              </Flexbox>
              {unavailable ? (
                <Alert title={t('lobeBench.dashboard.caseUnavailable')} type={'warning'} />
              ) : (
                <>
                  {a.verdict === 'judge_error' && (
                    <Alert title={t('lobeBench.compare.judgeError')} type={'warning'} />
                  )}
                  <Flexbox horizontal gap={16} wrap={'wrap'}>
                    <Text fontSize={12} type={'secondary'}>
                      {t('lobeBench.compare.toolCalls')} · {a.toolCalls ?? '—'}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('lobeBench.compare.timeCost')} ·{' '}
                      {a.duration
                        ? t('lobeBench.unit.min', { value: (a.duration / 60_000).toFixed(1) })
                        : '—'}{' '}
                      · {formatCost(a.cost)}
                    </Text>
                  </Flexbox>
                  <Flexbox gap={4}>
                    <Text fontSize={12} weight={500}>
                      {t('lobeBench.compare.reason')}
                    </Text>
                    {a.verdict === 'judge_error' ? (
                      <Text fontSize={13} style={{ whiteSpace: 'pre-wrap' }}>
                        {a.error ?? t('lobeBench.compare.noReason')}
                      </Text>
                    ) : a.verdicts?.length ? (
                      <Flexbox gap={4}>
                        {a.reason?.split('\n')[0] && !a.reason.startsWith('1. ') && (
                          <Text fontSize={13}>{a.reason.split('\n')[0]}</Text>
                        )}
                        {a.verdicts.map((item, index) => (
                          <Text
                            fontSize={12}
                            key={index}
                            type={
                              item.verdict === 'satisfied'
                                ? 'secondary'
                                : item.verdict === 'violated'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {item.verdict === 'satisfied'
                              ? '✓'
                              : item.verdict === 'violated'
                                ? '✗'
                                : '?'}{' '}
                            {item.rule}
                            {item.verdict !== 'satisfied' && item.reason ? ` — ${item.reason}` : ''}
                          </Text>
                        ))}
                      </Flexbox>
                    ) : (
                      <Text fontSize={13} style={{ whiteSpace: 'pre-wrap' }}>
                        {a.error && ['error', 'timeout'].includes(a.verdict)
                          ? a.error
                          : (a.reason ?? t('lobeBench.compare.noReason'))}
                      </Text>
                    )}
                  </Flexbox>
                  {traceUrl && (
                    <WorkspaceLink to={traceUrl}>
                      <Button size={'small'}>{t('lobeBench.compare.open')}</Button>
                    </WorkspaceLink>
                  )}
                </>
              )}
            </Flexbox>
          </Block>
        ))}
      </Flexbox>
    </Drawer>
  );
};
