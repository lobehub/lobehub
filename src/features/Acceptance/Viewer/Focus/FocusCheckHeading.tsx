'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { BadgeCheck, Ban, Check, CircleDashed, HelpCircle, RotateCcw, XCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { focusedCheckStates } from '../Checks/checkState';
import type { AcceptanceCheck } from '../Checks/types';
import { acceptanceFocusedLayout } from '../layout';

const REVIEW_ICON = {
  accepted: BadgeCheck,
  ignored: Ban,
  needsFix: RotateCcw,
  pending: CircleDashed,
} as const;

const REVIEW_COLOR = {
  accepted: cssVar.colorSuccess,
  ignored: cssVar.colorTextQuaternary,
  needsFix: cssVar.colorError,
  pending: cssVar.colorTextTertiary,
} as const;

const VERDICT_ICON = {
  failed: XCircle,
  notExecuted: CircleDashed,
  passed: Check,
  uncertain: HelpCircle,
} as const;

const VERDICT_COLOR = {
  failed: cssVar.colorError,
  notExecuted: cssVar.colorTextQuaternary,
  passed: cssVar.colorSuccess,
  uncertain: cssVar.colorWarning,
} as const;

interface FocusCheckHeadingProps {
  check: AcceptanceCheck;
  /** The one-line explanation of the agent's verdict; desktop only. */
  showVerdictDescription?: boolean;
  titleSize?: number;
}

/**
 * Who has ruled on this check, and what it claims.
 *
 * The two verdicts lead deliberately: the reviewer's own standing decision
 * first, then the agent's, so the question the page asks ("do you agree?") is
 * legible before the title explains what is being agreed with.
 */
export const FocusCheckHeading = memo<FocusCheckHeadingProps>(
  ({ check, showVerdictDescription, titleSize = 22 }) => {
    const { t } = useTranslation('verify');
    const states = focusedCheckStates(check);
    const verdict = states.verifierLabel as keyof typeof VERDICT_ICON;

    return (
      <Flexbox gap={acceptanceFocusedLayout.headerGap}>
        <Flexbox
          horizontal
          align={'center'}
          gap={5}
          style={{ color: REVIEW_COLOR[states.review], fontSize: 12 }}
        >
          <Icon icon={REVIEW_ICON[states.review]} size={14} />
          {t(`acceptance.focus.state.${states.review}`)}
          <Text style={{ color: cssVar.colorTextQuaternary }}>·</Text>
          <Flexbox horizontal align={'center'} gap={5} style={{ color: VERDICT_COLOR[verdict] }}>
            <Icon icon={VERDICT_ICON[verdict]} size={14} />
            {t('acceptance.focus.judgeLabel')} · {t(`report.verdict.${verdict}`)}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'baseline'} gap={8}>
          <Text
            style={{
              color: cssVar.colorTextTertiary,
              flex: 'none',
              fontFamily: cssVar.fontFamilyCode,
              fontSize: 12,
            }}
          >
            C{check.seq}
          </Text>
          <Text as={'h2'} style={{ fontSize: titleSize, margin: 0 }}>
            {check.title}
          </Text>
        </Flexbox>
        {showVerdictDescription && (
          <Text fontSize={13} type={'secondary'}>
            {t(`acceptance.focus.verifierDescription.${verdict}`)}
          </Text>
        )}
      </Flexbox>
    );
  },
);

FocusCheckHeading.displayName = 'AcceptanceFocusCheckHeading';
