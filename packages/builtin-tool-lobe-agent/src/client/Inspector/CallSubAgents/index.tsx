'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { GroupBotIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { CallSubAgentsParams, CallSubAgentsState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  label: css`
    flex-shrink: 0;
    color: ${cssVar.colorText};
  `,
  more: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  root: css`
    gap: 6px;
  `,
}));

/** Show every description when there are at most this many; otherwise collapse. */
const MAX_VISIBLE = 2;

/**
 * Collapsed row for lobe-agent's `callSubAgents`. Leading bot icon + "Call
 * SubAgents" label, then each sub-agent description as a chip when there are
 * few (<= 2). Beyond that, only the first is shown followed by a "{{count}} in
 * total" tail to keep the row compact.
 */
export const CallSubAgentsInspector = memo<
  BuiltinInspectorProps<CallSubAgentsParams, CallSubAgentsState>
>(({ args, partialArgs, isArgumentsStreaming }) => {
  const { t } = useTranslation('plugin');

  const tasks = args?.tasks || partialArgs?.tasks || [];
  const descriptions = tasks.map((task) => task?.description?.trim()).filter(Boolean) as string[];
  const count = descriptions.length;

  const isShiny = isArgumentsStreaming;
  const visible = count > MAX_VISIBLE ? descriptions.slice(0, 1) : descriptions;
  const showMore = count > MAX_VISIBLE;

  return (
    <div
      className={cx(inspectorTextStyles.root, styles.root, isShiny && shinyTextStyles.shinyText)}
    >
      <GroupBotIcon className={styles.icon} size={14} />
      <span className={styles.label}>{t('builtins.lobe-agent.apiName.callSubAgents')}</span>
      {visible.map((description, index) => (
        <span className={styles.chip} key={index}>
          {description}
        </span>
      ))}
      {showMore && (
        <span className={styles.more}>
          {t('builtins.lobe-agent.apiName.callSubAgents.more', { count })}
        </span>
      )}
    </div>
  );
});

CallSubAgentsInspector.displayName = 'CallSubAgentsInspector';

export default CallSubAgentsInspector;
