'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, ShieldCheck, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SetTaskVerifyParams, SetTaskVerifyState } from '../../../types';
import {
  AssigneeInline,
  InlineField,
  monoChipClassName,
  SectionField,
  TaskResultCard,
} from '../shared';

const styles = createStaticStyles(({ css, cssVar }) => ({
  offBadge: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  onBadge: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorSuccess};

    background: ${cssVar.colorSuccessBg};
  `,
}));

export const SetTaskVerifyRender = memo<
  BuiltinRenderProps<SetTaskVerifyParams, SetTaskVerifyState>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');

  const params = args ?? ({} as Partial<SetTaskVerifyParams>);
  const identifier = pluginState?.identifier ?? params.identifier;
  const enabled = pluginState?.enabled ?? params.enabled;
  const requirement = params.requirement;
  const maxIterations = params.maxIterations;
  const verifier = params.verifierAgentId;
  const rubric = params.verifyRubricId;
  const criteriaCount = params.verifyCriteriaIds?.length ?? 0;

  const showStatus = enabled === true || enabled === false;
  const hasBody =
    showStatus ||
    !!requirement ||
    typeof maxIterations === 'number' ||
    !!verifier ||
    !!rubric ||
    criteriaCount > 0;

  return (
    <TaskResultCard
      icon={ShieldCheck}
      iconColor={enabled === false ? cssVar.colorTextTertiary : cssVar.colorSuccess}
      identifier={identifier}
      title={t('builtins.lobe-task.apiName.setTaskVerify')}
    >
      {hasBody ? (
        <>
          {showStatus && (
            <span className={enabled ? styles.onBadge : styles.offBadge}>
              <Icon icon={enabled ? Check : X} size={13} />
              {t(enabled ? 'builtins.lobe-task.verify.on' : 'builtins.lobe-task.verify.off')}
            </span>
          )}
          {requirement && (
            <SectionField label={t('builtins.lobe-task.verify.requirement')}>
              {requirement}
            </SectionField>
          )}
          {typeof maxIterations === 'number' && (
            <InlineField label={t('builtins.lobe-task.verify.maxIterations')}>
              {maxIterations}
            </InlineField>
          )}
          {verifier && (
            <InlineField label={t('builtins.lobe-task.verify.verifier')}>
              <AssigneeInline agentId={verifier} />
            </InlineField>
          )}
          {rubric && (
            <InlineField label={t('builtins.lobe-task.verify.rubric')}>
              <span className={monoChipClassName}>{rubric}</span>
            </InlineField>
          )}
          {criteriaCount > 0 && (
            <InlineField label={t('builtins.lobe-task.verify.criteria')}>
              {criteriaCount}
            </InlineField>
          )}
        </>
      ) : null}
    </TaskResultCard>
  );
});

SetTaskVerifyRender.displayName = 'SetTaskVerifyRender';

export default SetTaskVerifyRender;
