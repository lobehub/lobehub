'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Icon, Markdown } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { Check, ShieldCheck, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveTaskOpenTarget } from '../../../taskRef';
import type { SetTaskVerifyParams, SetTaskVerifyState } from '../../../types';
import { TaskResultCard } from '../shared';

const styles = stylex.create({ offBadge: { display: "inline-flex", flexShrink: 0, gap: "4px", alignItems: "center", paddingBlock: "2px", paddingInline: "8px", borderRadius: "999px", fontSize: "12px", color: cssVar.colorTextTertiary, backgroundColor: cssVar.colorFillTertiary, backgroundImage: "none" }, onBadge: { display: "inline-flex", flexShrink: 0, gap: "4px", alignItems: "center", paddingBlock: "2px", paddingInline: "8px", borderRadius: "999px", fontSize: "12px", color: cssVar.colorSuccess, backgroundColor: cssVar.colorSuccessBg, backgroundImage: "none" } });

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
    <span {...stylex.props(enabled ? styles.onBadge : styles.offBadge)}>
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
      taskId={resolveTaskOpenTarget(pluginState, params)}
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
