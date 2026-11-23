'use client';

import { Button, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClipboardList } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePlanMode } from './usePlanMode';

const styles = stylex.create({
  // Hidden on a narrow bar like the other chips' labels; the tooltip still names it.
  label: {
    display: {
      'default': null,
      '@container runtimebar (width < 600px)': 'none',
    },
  },
  nextTurn: { fontSize: '12px', color: cssVar.colorTextDescription, whiteSpace: 'nowrap' },
  off: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextSecondary },
  on: {
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorPrimary,
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
  },
});

interface PlanModeSwitchProps {
  agentId: string;
  topicId: string | null | undefined;
}

/**
 * The composer's Codex Plan switch (Better Coding Experience lab). Not a
 * permission mode: Codex keeps allowing every action; in plan it proposes a
 * plan instead of carrying the request out.
 */
const PlanModeSwitch = ({ agentId, topicId }: PlanModeSwitchProps) => {
  const { t } = useTranslation('chat');
  const { enabled, nextTurnPending, setEnabled, unavailable } = usePlanMode(agentId, topicId);

  const tooltip = unavailable
    ? t(`heteroAgent.planMode.unavailable.${unavailable}`)
    : t(enabled ? 'heteroAgent.planMode.tooltipOn' : 'heteroAgent.planMode.tooltipOff');

  return (
    <Flexbox horizontal align={'center'} data-testid={'hetero-plan-mode'} gap={6}>
      {nextTurnPending && (
        <span data-testid={'hetero-plan-mode-next-turn'} {...stylex.props(styles.nextTurn)}>
          {t('heteroAgent.planMode.nextTurn')}
        </span>
      )}
      <Tooltip title={tooltip}>
        {/* The wrapper keeps the tooltip on a disabled button. */}
        <span>
          <Button
            aria-label={t('heteroAgent.planMode.label')}
            aria-pressed={enabled}
            className={stylex.props(enabled && !unavailable ? styles.on : styles.off).className}
            disabled={!!unavailable}
            size="small"
            type={'text'}
            onClick={() => void setEnabled(!enabled)}
          >
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={ClipboardList} size={14} />
              <span {...stylex.props(styles.label)}>{t('heteroAgent.planMode.label')}</span>
            </Flexbox>
          </Button>
        </span>
      </Tooltip>
    </Flexbox>
  );
};

export default PlanModeSwitch;
