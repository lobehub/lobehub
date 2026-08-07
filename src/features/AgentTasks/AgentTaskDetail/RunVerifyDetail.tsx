'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerifyResults } from '@/features/Verify';

const styles = createStaticStyles(({ css }) => ({
  check: css`
    padding-block: 6px;
    padding-inline: 10px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  reason: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const verdictIcon = (verdict: string | null) => {
  if (verdict === 'passed') return { color: cssVar.colorSuccess, icon: CircleCheck };
  if (verdict) return { color: cssVar.colorError, icon: CircleX };
  return { color: cssVar.colorTextQuaternary, icon: CircleDashed };
};

/**
 * The per-check breakdown behind a run's verdict, fetched only once the run is
 * expanded — a collapsed feed of many rounds should not pull every round's
 * results just to show a tag.
 */
const RunVerifyDetail = memo<{
  /** The run's verdict tag, which follows the list once it is open. */
  extra?: ReactNode;
  operationId?: string | null;
}>(({ extra, operationId }) => {
  const { t } = useTranslation('chat');
  const { data: results } = useVerifyResults(operationId ?? null);

  if (!results?.length) return null;

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text fontSize={12} type={'secondary'}>
          {t('taskDetail.runVerify.checklist')}
        </Text>
        {extra}
      </Flexbox>
      <Flexbox className={styles.list}>
        {results.map((result) => {
          const meta = verdictIcon(result.verdict);
          // An LLM judge's reasoning IS its product; a programmatic check
          // usually has none, and then the verdict alone is the whole story.
          const reasoning = (result.toulmin as { reasoning?: string } | null)?.reasoning;

          return (
            <Flexbox className={styles.check} gap={4} key={result.id}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Icon color={meta.color} icon={meta.icon} size={14} style={{ flex: 'none' }} />
                <Text ellipsis fontSize={13} style={{ flex: 1, minWidth: 0 }}>
                  {result.checkItemTitle}
                </Text>
              </Flexbox>
              {reasoning && (
                <Text className={styles.reason} style={{ whiteSpace: 'pre-wrap' }}>
                  {reasoning}
                </Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

RunVerifyDetail.displayName = 'RunVerifyDetail';

export default RunVerifyDetail;
