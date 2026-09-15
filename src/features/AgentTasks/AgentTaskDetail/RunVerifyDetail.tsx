'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, ChevronDown, ChevronRight, CircleDashed, X } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useVerifyResults } from '@/features/Acceptance';

const styles = createStaticStyles(({ css }) => ({
  check: css`
    padding-block: 6px;
    padding-inline: 10px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  header: css`
    justify-content: flex-start;

    width: 100%;
    height: auto;
    margin: -4px;
    padding: 4px;
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
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
  if (verdict === 'passed') return { color: cssVar.colorSuccess, icon: Check };
  if (verdict) return { color: cssVar.colorError, icon: X };
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
  const [expanded, setExpanded] = useState(true);

  if (!results?.length) return null;

  return (
    <Flexbox gap={6}>
      <Button
        aria-expanded={expanded}
        className={styles.header}
        title={t(expanded ? 'taskDetail.runCollapse' : 'taskDetail.runExpand')}
        type={'text'}
        onClick={() => setExpanded((open) => !open)}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={expanded ? ChevronDown : ChevronRight}
            size={12}
          />
          <Text fontSize={12} type={'secondary'}>
            {t('taskDetail.runVerify.checklist')}
          </Text>
          {extra}
        </Flexbox>
      </Button>
      {expanded && (
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
      )}
    </Flexbox>
  );
});

RunVerifyDetail.displayName = 'RunVerifyDetail';

export default RunVerifyDetail;
