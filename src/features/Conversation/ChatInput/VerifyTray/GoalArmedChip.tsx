'use client';

import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { TargetIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { useConversationStore } from '../../store';
import { useGoalArmStore } from './goalArmStore';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

/**
 * Pre-topic "armed goal" indicator — a Codex-style chip that sits inline in the
 * composer action bar (next to `+`) once a goal has been armed from the `+`
 * menu but no topic exists yet, i.e. the next message the user sends becomes the
 * goal. Clicking it cancels the arm.
 *
 * It is only ever the pre-topic armed state: the moment a topic exists the goal
 * earns its persistent home in the tray above the composer, so this chip hides.
 * Self-gating (returns null unless armed) so it can be appended unconditionally
 * to the action bar of every composer that renders the shared ChatInput.
 */
const GoalArmedChip = memo(() => {
  const { t } = useTranslation('verify');
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);
  const agentId = useConversationStore((s) => s.context.agentId);
  const topicId = useConversationStore((s) => s.context.topicId);
  const armedAt = useGoalArmStore((s) => (agentId ? s.armedAt[agentId] : undefined));
  const disarm = useGoalArmStore((s) => s.disarm);

  if (!enabled || !agentId || topicId || armedAt === undefined) return null;

  return (
    <Tooltip title={t('acceptance.tray.goalDisarm')}>
      <div className={styles.chip} onClick={() => disarm(agentId)}>
        <Icon icon={TargetIcon} size={14} />
        <span>{t('acceptance.tray.goalLabel')}</span>
      </div>
    </Tooltip>
  );
});

GoalArmedChip.displayName = 'GoalArmedChip';

export default GoalArmedChip;
