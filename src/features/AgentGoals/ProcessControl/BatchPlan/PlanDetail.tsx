import { Flexbox, Markdown } from '@lobehub/ui';
import { Segmented, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchModel, BatchRound } from '../Graph/batchModel';
import { planDiff } from './planDiff';

/**
 * Every version of a batch's plan, for the panel that opens on one of them:
 * pick a version, pick what to compare it with (the previous one by default),
 * read the line diff, then the version in full.
 */

const styles = createStaticStyles(({ css }) => ({
  diff: css`
    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.7;
  `,
  line: css`
    padding-inline: 10px;
    white-space: pre-wrap;
  `,
  added: css`
    color: ${cssVar.colorSuccessText};
    background: ${cssVar.colorSuccessBg};
  `,
  removed: css`
    color: ${cssVar.colorErrorText};
    text-decoration: line-through;
    background: ${cssVar.colorErrorBg};
  `,
  same: css`
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const Section = memo<{ children: ReactNode; title: string }>(({ children, title }) => (
  <Flexbox gap={6}>
    <span className={styles.label}>{title}</span>
    {children}
  </Flexbox>
));

Section.displayName = 'GoalPlanDetailSection';

const MARK = { added: '+ ', removed: '− ', same: '  ' } as const;

interface PlanDetailProps {
  graph: GoalGraphView;
  model: BatchModel;
  round: BatchRound;
}

const PlanDetail = memo<PlanDetailProps>(({ graph, model, round }) => {
  const { t } = useTranslation('chat');
  const versions = model.rounds.filter((item) => item.templateId);
  const [selected, setSelected] = useState(round.revision);
  const [base, setBase] = useState<number | undefined>(undefined);

  const current = versions.find((item) => item.revision === selected) ?? round;
  const earlier = versions.filter((item) => item.revision < current.revision);
  // Compare with the previous version unless the reader picked another.
  const against = earlier.find((item) => item.revision === base) ?? earlier.at(-1);
  const textOf = (item?: BatchRound) =>
    (item?.templateId && graph.byId[item.templateId]?.node.description) || '';

  const lines = against ? planDiff(textOf(against), textOf(current)) : [];
  const changed = lines.some((line) => line.kind !== 'same');

  return (
    <Flexbox data-plan-detail gap={16}>
      {versions.length > 1 && (
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <span className={styles.label}>{t('goalBatch.planPanel.version')}</span>
          <Segmented
            size={'small'}
            value={String(current.revision)}
            options={versions.map((item) => ({
              label: `v${item.revision}`,
              value: String(item.revision),
            }))}
            onChange={(value) => {
              setSelected(Number(value));
              setBase(undefined);
            }}
          />
          {earlier.length > 1 && (
            <>
              <span className={styles.label}>{t('goalBatch.planPanel.compare')}</span>
              <Segmented
                size={'small'}
                value={against ? String(against.revision) : undefined}
                options={earlier.map((item) => ({
                  label: `v${item.revision}`,
                  value: String(item.revision),
                }))}
                onChange={(value) => setBase(Number(value))}
              />
            </>
          )}
        </Flexbox>
      )}

      {current.forked && (
        <Text fontSize={12} type={'secondary'}>
          {t('goalBatch.planPanel.forked')}
        </Text>
      )}

      {against ? (
        <Section
          title={t('goalBatch.planPanel.diff', {
            base: against.revision,
            revision: current.revision,
          })}
        >
          {changed ? (
            <div data-plan-diff className={styles.diff}>
              {lines.map((line, index) => (
                <div
                  className={cx(styles.line, styles[line.kind])}
                  data-diff={line.kind}
                  key={index}
                >
                  {MARK[line.kind]}
                  {line.text}
                </div>
              ))}
            </div>
          ) : (
            <Text fontSize={12} type={'secondary'}>
              {t('goalBatch.planPanel.same', { base: against.revision })}
            </Text>
          )}
        </Section>
      ) : (
        <Text fontSize={12} type={'secondary'}>
          {t('goalBatch.planPanel.first')}
        </Text>
      )}

      <Section title={t('goalBatch.planPanel.full', { revision: current.revision })}>
        <Markdown fontSize={13} style={{ flexShrink: 0 }} variant={'chat'}>
          {textOf(current)}
        </Markdown>
      </Section>
    </Flexbox>
  );
});

PlanDetail.displayName = 'GoalBatchPlanDetail';

export default PlanDetail;
