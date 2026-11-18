import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheck, CircleDashed, CircleHelp, CircleX, type LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type AcceptanceCheckState = 'failed' | 'not_executed' | 'passed' | 'uncertain';

export interface AcceptanceCheckItem {
  state: AcceptanceCheckState;
  /** The verifier's reasoning, when it wrote one. */
  summary?: string | null;
  /** The criterion text. */
  title: string;
}

const VISUAL: Record<AcceptanceCheckState, { color: string; icon: LucideIcon }> = {
  failed: { color: cssVar.colorError, icon: CircleX },
  not_executed: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  passed: { color: cssVar.colorSuccess, icon: CircleCheck },
  uncertain: { color: cssVar.colorWarning, icon: CircleHelp },
};

const styles = stylex.create({
  row: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingBlock: 10,
    paddingInline: 12,
  },
});

export interface AcceptanceChecksProps {
  checks: AcceptanceCheckItem[];
}

/**
 * Each criterion an acceptance judged, with its verdict and the verifier's
 * reasoning. Presentation only: it carries no evidence viewer and opens
 * nothing, so it is safe wherever a reader has no product to drill into.
 */
const AcceptanceChecks = memo<AcceptanceChecksProps>(({ checks }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={8} role={'list'}>
      {checks.map((check, index) => {
        const { color, icon } = VISUAL[check.state];
        const verdict = t(`goalShare.check.state.${check.state}`);

        return (
          <Flexbox gap={6} key={index} role={'listitem'} {...stylex.props(styles.row)}>
            <Flexbox horizontal align={'flex-start'} gap={8}>
              <Icon aria-label={verdict} icon={icon} size={16} style={{ color, flex: 'none' }} />
              <Text style={{ flex: 1, minWidth: 0 }} weight={500}>
                {check.title}
              </Text>
              <Text fontSize={12} style={{ color, flex: 'none' }}>
                {verdict}
              </Text>
            </Flexbox>
            {check.summary?.trim() && (
              <Markdown fontSize={13} variant={'chat'}>
                {check.summary}
              </Markdown>
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

AcceptanceChecks.displayName = 'GoalAcceptanceChecks';

export default AcceptanceChecks;
