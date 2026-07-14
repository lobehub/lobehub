'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export interface CodexErrorArgs {
  id?: string;
  message?: string;
  type?: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    flex: none;
    color: ${cssVar.colorWarning};
  `,
  message: css`
    overflow: hidden;

    min-width: 0;

    color: ${cssVar.colorWarningText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  root: css`
    gap: 6px;
    align-items: center;
  `,
}));

const ErrorInspector = memo<BuiltinInspectorProps<CodexErrorArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const message = args?.message?.trim() || partialArgs?.message?.trim();
    const fallback = t('builtins.codex.error.fallback', {
      defaultValue: 'Codex reported a warning',
    });

    return (
      <div
        data-testid="codex-error-inspector"
        className={cx(
          inspectorTextStyles.root,
          styles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <Icon className={styles.icon} icon={AlertTriangle} size={14} />
        <span className={styles.message}>{message || fallback}</span>
      </div>
    );
  },
);

ErrorInspector.displayName = 'CodexErrorInspector';

export default ErrorInspector;
