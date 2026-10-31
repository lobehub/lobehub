'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DuplicateAgentParams, DuplicateAgentState } from '../../../types';

const styles = stylex.create({
  container: { padding: '12px', borderRadius: '8px', background: cssVar.colorFillQuaternary },
  label: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextSecondary },
  value: { fontSize: '13px' },
});

export const DuplicateAgentRender = memo<
  BuiltinRenderProps<DuplicateAgentParams, DuplicateAgentState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');

  if (!pluginState?.success) return null;

  return (
    <div {...stylex.props(styles.container)}>
      <Flexbox gap={8}>
        <Flexbox gap={2}>
          <span {...stylex.props(styles.label)}>
            {t('builtins.lobe-agent-management.render.duplicateAgent.sourceId')}
          </span>
          <span {...stylex.props(styles.value)}>{pluginState.sourceAgentId}</span>
        </Flexbox>
        <Flexbox gap={2}>
          <span {...stylex.props(styles.label)}>
            {t('builtins.lobe-agent-management.render.duplicateAgent.newId')}
          </span>
          <span {...stylex.props(styles.value)}>{pluginState.newAgentId}</span>
        </Flexbox>
      </Flexbox>
    </div>
  );
});

DuplicateAgentRender.displayName = 'DuplicateAgentRender';

export default DuplicateAgentRender;
