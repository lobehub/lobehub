'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export interface CodexErrorArgs {
  id?: string;
  message?: string;
  type?: string;
}

const styles = stylex.create({
  icon: { flex: 'none', color: cssVar.colorWarning },
  message: {
    overflow: 'hidden',
    minWidth: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  messageColor: { color: cssVar.colorWarningText },
  root: { gap: '6px', alignItems: 'center' },
});

const ErrorInspector = memo<BuiltinInspectorProps<CodexErrorArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const message = args?.message?.trim() || partialArgs?.message?.trim();
    const fallback = t('builtins.codex.error.fallback', {
      defaultValue: 'Codex reported a warning',
    });

    return (
      <div
        className={cx(inspectorTextStyles.root, stylex.props(styles.root).className)}
        data-testid="codex-error-inspector"
      >
        <Icon className={stylex.props(styles.icon).className} icon={AlertTriangle} size={14} />
        <span
          className={cx(
            stylex.props(
              styles.message,
              !(isArgumentsStreaming || isLoading) && styles.messageColor,
            ).className,
            (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
          )}
        >
          {message || fallback}
        </span>
      </div>
    );
  },
);

ErrorInspector.displayName = 'CodexErrorInspector';

export default ErrorInspector;
