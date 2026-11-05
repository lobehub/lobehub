import type { GoalRolloutGateCheckKey } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type GateCheckLike, useGateCheckCopy } from './useGateCheckCopy';

/** Checks a batch's retro answers for; every other check is about the execution. */
const RETRO_CHECKS = new Set<GoalRolloutGateCheckKey>(['interventions_accounted', 'reverified']);

const styles = stylex.create({
  root: { minWidth: '220px', maxWidth: '300px', paddingBlock: '2px', fontSize: '12px' },
  section: { fontSize: '11px', color: cssVar.colorTextTertiary },
  detail: { color: cssVar.colorTextTertiary },
});

const CheckRow = memo<{ check: GateCheckLike }>(({ check }) => {
  const copy = useGateCheckCopy();
  const { detail, label } = copy(check);
  const visual =
    check.passed === undefined
      ? { color: cssVar.colorTextQuaternary, icon: CircleDashed }
      : check.passed
        ? { color: cssVar.green9, icon: CircleCheck }
        : { color: cssVar.colorError, icon: CircleX };
  return (
    <Flexbox horizontal align={'flex-start'} gap={6}>
      <Icon
        icon={visual.icon}
        size={13}
        style={{ color: visual.color, flex: 'none', marginTop: 2 }}
      />
      <span>
        {label}
        {detail && <span {...stylex.props(styles.detail)}> · {detail}</span>}
      </span>
    </Flexbox>
  );
});

CheckRow.displayName = 'GoalGateCheckRow';

/**
 * What a batch gate checks, behind the info icon on its card: the execution's
 * checks, then what the retro answers for. Before a verdict every check reads
 * as still to be judged; after one, each carries its result.
 */
const GateChecksHint = memo<{ checks: GateCheckLike[] }>(({ checks }) => {
  const { t } = useTranslation('chat');
  const sections = [
    { checks: checks.filter((check) => !RETRO_CHECKS.has(check.key)), key: 'execution' as const },
    { checks: checks.filter((check) => RETRO_CHECKS.has(check.key)), key: 'retro' as const },
  ].filter((section) => section.checks.length);
  return (
    <Flexbox className={stylex.props(styles.root).className} gap={8}>
      {sections.map((section) => (
        <Flexbox gap={4} key={section.key}>
          <span {...stylex.props(styles.section)}>
            {t(`goalBatch.gate.hintSection.${section.key}`)}
          </span>
          {section.checks.map((check) => (
            <CheckRow check={check} key={check.key} />
          ))}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

GateChecksHint.displayName = 'GoalGateChecksHint';

export default GateChecksHint;
