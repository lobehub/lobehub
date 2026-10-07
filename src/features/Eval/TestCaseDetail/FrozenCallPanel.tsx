'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ChevronDown, ChevronUp, Snowflake } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';
import ModelLabel from '@/features/Eval/components/ModelLabel';

import { frozenToolNames, frozenTurns, readFrozenCall } from './frozenCall';
import MessageBlock from './MessageBlock';

const styles = createStaticStyles(({ css }) => ({
  block: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  divider: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  facts: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 16px;
    padding: 16px;
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  toggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;

    padding: 0;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  value: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSize};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const Fact = ({ children, label }: { children: ReactNode; label: string }) => (
  <Flexbox gap={4} style={{ minWidth: 0 }}>
    <span className={styles.label}>{label}</span>
    {children}
  </Flexbox>
);

interface FrozenCallPanelProps {
  frozenCall: unknown;
  /** The column copy of `frozenCall.stepIndex` — set on cases frozen before the call was inline. */
  frozenStepIndex?: number | null;
}

/**
 * The exact LLM call every replay re-issues: which model first answered it,
 * when it was copied out of the trace, and what the model saw — messages and
 * tools.
 */
const FrozenCallPanel = memo<FrozenCallPanelProps>(({ frozenCall, frozenStepIndex }) => {
  const { t } = useTranslation('eval');
  const [open, setOpen] = useState(false);
  const call = readFrozenCall(frozenCall);
  const turns = useMemo(() => frozenTurns(call?.messages), [call]);
  const tools = useMemo(() => frozenToolNames(call?.tools), [call]);

  let body;
  if (!call) {
    const isFrozen = typeof frozenStepIndex === 'number';
    body = (
      <EvalEmpty
        compact
        icon={Snowflake}
        description={
          isFrozen
            ? t('caseDetail.frozen.notInline.desc', { step: frozenStepIndex })
            : t('caseDetail.frozen.none.desc')
        }
        title={
          isFrozen ? t('caseDetail.frozen.notInline.title') : t('caseDetail.frozen.none.title')
        }
      />
    );
  } else {
    body = (
      <div className={styles.block}>
        <div className={styles.facts}>
          <Fact label={t('caseDetail.frozen.model')}>
            {call.model ? (
              <ModelLabel model={call.model} provider={call.provider} />
            ) : (
              <span className={styles.value}>—</span>
            )}
          </Fact>
          <Fact label={t('caseDetail.frozen.frozenAt')}>
            <span className={styles.value} title={call.frozenAt}>
              {call.frozenAt ? dayjs(call.frozenAt).format('YYYY-MM-DD HH:mm') : '—'}
            </span>
          </Fact>
          <Fact label={t('caseDetail.frozen.step')}>
            <span className={styles.value}>#{call.stepIndex}</span>
          </Fact>
          <Fact label={t('caseDetail.frozen.messages')}>
            <span className={styles.value}>{turns.length}</span>
          </Fact>
          <Fact label={t('caseDetail.frozen.tools')}>
            <span className={styles.value}>{tools.length}</span>
          </Fact>
        </div>
        {(turns.length > 0 || tools.length > 0) && (
          <Flexbox className={styles.divider} gap={16} padding={16}>
            <button className={styles.toggle} type="button" onClick={() => setOpen((v) => !v)}>
              {open ? t('caseDetail.frozen.hide') : t('caseDetail.frozen.show')}
              <Icon icon={open ? ChevronUp : ChevronDown} size={12} />
            </button>
            {open && (
              <>
                {tools.length > 0 && (
                  <Flexbox gap={8}>
                    <span className={styles.label}>{t('caseDetail.frozen.toolNames')}</span>
                    <Flexbox horizontal gap={6} wrap="wrap">
                      {tools.map((name) => (
                        <Tag key={name} size="small">
                          {name}
                        </Tag>
                      ))}
                    </Flexbox>
                  </Flexbox>
                )}
                {turns.map((turn, i) => (
                  <MessageBlock
                    badge={turn.toolCalls.length ? turn.toolCalls.join(', ') : undefined}
                    content={turn.text || t('caseDetail.frozen.noText')}
                    key={i}
                    muted={turn.role === 'system'}
                    role={turn.role}
                  />
                ))}
              </>
            )}
          </Flexbox>
        )}
      </div>
    );
  }

  return (
    <EvalSection description={t('caseDetail.frozen.desc')} title={t('caseDetail.frozen.title')}>
      {body}
    </EvalSection>
  );
});

FrozenCallPanel.displayName = 'EvalFrozenCallPanel';

export default FrozenCallPanel;
