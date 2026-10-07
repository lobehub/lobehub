'use client';

import { CopyButton, Flexbox, Markdown } from '@lobehub/ui';
import { Drawer, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDuration } from '../utils';
import CaseDefinition from './CaseDefinition';
import { styles } from './style';
import {
  caseLabel,
  cellVerdict,
  type ComparisonCase,
  type ComparisonCell,
  formatToolCalls,
} from './utils';
import VerdictTag from './VerdictTag';

interface CellDetailDrawerProps {
  cell?: ComparisonCell;
  onClose: () => void;
  testCase?: ComparisonCase;
}

/**
 * One model's answer to one case, next to everything it was judged against —
 * a reader can re-judge the cell by eye without leaving the page.
 */
const CellDetailDrawer = memo<CellDetailDrawerProps>(({ cell, onClose, testCase }) => {
  const { t } = useTranslation('eval');
  const open = !!cell && !!testCase;
  const toolCalls = formatToolCalls(cell?.toolCalls);

  return (
    <Drawer
      open={open}
      placement="right"
      title={cell ? `${cell.provider}/${cell.model}` : undefined}
      width={640}
      onClose={onClose}
    >
      {cell && testCase && (
        <Flexbox data-testid="comparison-cell-detail" gap={20}>
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            <VerdictTag verdict={cellVerdict(cell)} />
            {typeof cell.score === 'number' && (
              <Text className={styles.mono}>
                {t('comparison.cell.score', { score: cell.score.toFixed(2) })}
              </Text>
            )}
            {typeof cell.durationMs === 'number' && (
              <Text className={styles.mono} type="secondary">
                {formatDuration(cell.durationMs)}
              </Text>
            )}
            {cell.usage?.totalTokens !== undefined && (
              <Text className={styles.mono} type="secondary">
                {t('comparison.cell.tokens', {
                  completion: cell.usage.completionTokens ?? '-',
                  prompt: cell.usage.promptTokens ?? '-',
                })}
              </Text>
            )}
            <Text className={styles.mono} type="secondary">
              {caseLabel(testCase)}
            </Text>
          </Flexbox>

          {cell.error && (
            <Flexbox gap={6}>
              <span className={styles.label}>{t(`comparison.cell.error.${cell.error.stage}`)}</span>
              <div className={styles.prose} style={{ color: cssVar.colorWarning }}>
                {cell.error.message}
              </div>
            </Flexbox>
          )}

          <Flexbox gap={6}>
            <Flexbox horizontal align="center" justify="space-between">
              <span className={styles.label}>{t('comparison.field.actual')}</span>
              {cell.content && <CopyButton content={cell.content} size="small" />}
            </Flexbox>
            {cell.content ? (
              <div className={styles.prose} style={{ maxHeight: 360, whiteSpace: 'normal' }}>
                <Markdown variant="chat">{cell.content}</Markdown>
              </div>
            ) : (
              <Text fontSize={12} type="secondary">
                {t('comparison.cell.noText')}
              </Text>
            )}
          </Flexbox>

          {toolCalls && (
            <Flexbox gap={6}>
              <span className={styles.label}>{t('comparison.field.toolCalls')}</span>
              <div className={`${styles.prose} ${styles.mono}`}>{toolCalls}</div>
            </Flexbox>
          )}

          <Flexbox gap={6}>
            <span className={styles.label}>{t('comparison.field.judgeReason')}</span>
            {cell.judgeReason ? (
              <div className={styles.prose}>{cell.judgeReason}</div>
            ) : (
              <Text fontSize={12} type="secondary">
                {t('comparison.cell.noReason')}
              </Text>
            )}
          </Flexbox>

          <CaseDefinition expanded testCase={testCase} />
        </Flexbox>
      )}
    </Drawer>
  );
});

CellDetailDrawer.displayName = 'EvalComparisonCellDetailDrawer';

export default CellDetailDrawer;
