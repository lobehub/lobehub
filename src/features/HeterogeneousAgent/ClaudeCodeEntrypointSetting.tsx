'use client';

import {
  CLAUDE_CODE_ENTRYPOINT_ENV,
  DEFAULT_CLAUDE_CODE_ENTRYPOINT,
  normalizeClaudeCodeEntrypoint,
} from '@lobechat/heterogeneous-agents';
import { Flexbox, Input, Switch, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  hint: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    lineHeight: '18px',
  },
  input: {
    fontFamily: cssVar.fontFamilyCode,
    width: 'min(200px, 100%)',
  },
  risk: {
    color: cssVar.colorWarning,
    fontSize: 12,
    lineHeight: '18px',
  },
  switchLine: {
    minHeight: 28,
  },
});

interface ClaudeCodeEntrypointSettingProps {
  disabled?: boolean;
  /** The agent's configured env; the entrypoint is one variable in it. */
  env?: Record<string, string>;
  onEnvChange?: (env: Record<string, string>) => Promise<void> | void;
}

/**
 * Lets a Claude Code agent report its own launch source. Off clears the
 * variable, so Claude Code reports its headless default.
 */
export const ClaudeCodeEntrypointSetting = memo<ClaudeCodeEntrypointSettingProps>(
  ({ disabled, env, onEnvChange }) => {
    const { t } = useTranslation('setting');
    const entrypoint = normalizeClaudeCodeEntrypoint(env?.[CLAUDE_CODE_ENTRYPOINT_ENV]);
    // Text being typed; `undefined` shows the saved entrypoint.
    const [draft, setDraft] = useState<string>();
    const [saving, setSaving] = useState(false);

    const save = async (next: string | undefined) => {
      if (disabled || saving || next === entrypoint) return;

      try {
        setSaving(true);
        // Agent config saves merge into the stored env, so a dropped key would
        // survive: an empty value is how a variable is cleared.
        await onEnvChange?.({ ...env, [CLAUDE_CODE_ENTRYPOINT_ENV]: next ?? '' });
      } finally {
        setSaving(false);
      }
    };

    const commitDraft = () => {
      if (draft === undefined) return;
      setDraft(undefined);
      // Cleared falls back to the default; a name that cannot be used keeps the saved one.
      void save(
        draft.trim()
          ? (normalizeClaudeCodeEntrypoint(draft) ?? entrypoint)
          : DEFAULT_CLAUDE_CODE_ENTRYPOINT,
      );
    };

    return (
      <Flexbox gap={6}>
        <Flexbox horizontal align="center" gap={8} wrap="wrap" {...stylex.props(styles.switchLine)}>
          <Switch
            aria-label={t('heterogeneousStatus.entrypoint.switch')}
            checked={!!entrypoint}
            disabled={disabled}
            loading={saving}
            size="small"
            onChange={(checked) => {
              void save(checked ? DEFAULT_CLAUDE_CODE_ENTRYPOINT : undefined);
            }}
          />
          {entrypoint && (
            <Input
              aria-label={t('heterogeneousStatus.entrypoint.label')}
              disabled={disabled || saving}
              maxLength={64}
              placeholder={DEFAULT_CLAUDE_CODE_ENTRYPOINT}
              size="small"
              value={draft ?? entrypoint}
              onBlur={commitDraft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(undefined);
                  return;
                }

                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                }
              }}
              {...stylex.props(styles.input)}
            />
          )}
        </Flexbox>
        <Text {...stylex.props(styles.hint)}>
          {t('heterogeneousStatus.entrypoint.desc', {
            interpolation: { escapeValue: false },
            name:
              normalizeClaudeCodeEntrypoint(draft) ?? entrypoint ?? DEFAULT_CLAUDE_CODE_ENTRYPOINT,
          })}
        </Text>
        <Text {...stylex.props(styles.risk)}>{t('heterogeneousStatus.entrypoint.risk')}</Text>
      </Flexbox>
    );
  },
);

ClaudeCodeEntrypointSetting.displayName = 'ClaudeCodeEntrypointSetting';
