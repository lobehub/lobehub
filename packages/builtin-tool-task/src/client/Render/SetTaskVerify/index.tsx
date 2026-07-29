'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Icon, Markdown } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Check, ShieldCheck, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SetTaskVerifyParams, SetTaskVerifyState } from '../../../types';
import { TaskResultCard } from '../shared';

const styles = createStaticStyles(({ css, cssVar }) => ({
  offBadge: css`
    display: inline-flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  onBadge: css`
    display: inline-flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

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
  const showStatus = enabled === true || enabled === false;

  // The on/off state lives in the header; the body is just the acceptance
  // requirement rendered as markdown.
  const statusBadge = showStatus ? (
    <span className={enabled ? styles.onBadge : styles.offBadge}>
      <Icon icon={enabled ? Check : X} size={13} />
      {t(enabled ? 'builtins.lobe-task.verify.on' : 'builtins.lobe-task.verify.off')}
    </span>
  ) : undefined;

  return (
    <TaskResultCard
      headerExtra={statusBadge}
      icon={ShieldCheck}
      iconColor={enabled === false ? cssVar.colorTextTertiary : cssVar.colorSuccess}
      identifier={identifier}
      title={t('builtins.lobe-task.apiName.setTaskVerify')}
    >
      {requirement ? (
        <Markdown fontSize={12} variant={'chat'}>
          {requirement}
        </Markdown>
      ) : null}
    </TaskResultCard>
  );
});

SetTaskVerifyRender.displayName = 'SetTaskVerifyRender';

export default SetTaskVerifyRender;
