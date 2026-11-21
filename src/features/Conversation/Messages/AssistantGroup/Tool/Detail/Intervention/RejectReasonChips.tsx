import type { ToolRejectionPresetCode } from '@lobechat/types';
import { TOOL_REJECTION_PRESET_CODES } from '@lobechat/types';
import { Button } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBlockStart: '6px',
    paddingInline: '12px',
  },
  hint: {
    fontSize: '12px',
    lineHeight: 1.4,
    color: cssVar.colorTextTertiary,
  },
});

interface RejectReasonChipsProps {
  disabled?: boolean;
  /** A typed reason already explains the rejection, so the fallback hint goes away. */
  hasNote: boolean;
  onChange: (code: ToolRejectionPresetCode | undefined) => void;
  value?: ToolRejectionPresetCode;
}

const RejectReasonChips = memo<RejectReasonChipsProps>(({ disabled, hasNote, onChange, value }) => {
  const { t } = useTranslation('chat');

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.chips)}>
        {TOOL_REJECTION_PRESET_CODES.map((code) => (
          <Button
            aria-pressed={value === code}
            disabled={disabled}
            key={code}
            shape={'round'}
            size={'small'}
            type={value === code ? 'primary' : 'default'}
            onClick={() => onChange(value === code ? undefined : code)}
          >
            {t(`tool.intervention.rejectReason.${code}`)}
          </Button>
        ))}
      </div>
      {!value && !hasNote && (
        <div {...stylex.props(styles.hint)}>{t('tool.intervention.rejectReasonDefaultHint')}</div>
      )}
    </div>
  );
});

RejectReasonChips.displayName = 'RejectReasonChips';

export default RejectReasonChips;
