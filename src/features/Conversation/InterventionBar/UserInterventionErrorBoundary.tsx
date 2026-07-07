'use client';

import { safeParseJSON } from '@lobechat/utils';
import { Flexbox, Highlighter, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AlertTriangle } from 'lucide-react';
import type { ErrorInfo, ReactNode } from 'react';
import { Component, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    flex: none;
    color: ${cssVar.colorWarning};
  `,
  notice: css`
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    padding-block: 2px;

    font-size: 12px;
    line-height: 1.5;
  `,
  title: css`
    flex: none;
    font-weight: 500;
    color: ${cssVar.colorWarning};
  `,
}));

interface UserInterventionFallbackProps {
  apiName: string;
  identifier: string;
  requestArgs: string;
}

interface UserInterventionErrorBoundaryProps extends UserInterventionFallbackProps {
  children: ReactNode;
  toolCallId: string;
}

interface UserInterventionErrorBoundaryState {
  hasError: boolean;
}

const formatRequestArgs = (requestArgs: string) => {
  const parsed = safeParseJSON<unknown>(requestArgs);

  if (parsed === undefined) return requestArgs.trim() || '{}';

  return JSON.stringify(parsed, null, 2);
};

const UserInterventionFallback = memo<UserInterventionFallbackProps>(
  ({ apiName, identifier, requestArgs }) => {
    const { t } = useTranslation('chat');
    const json = useMemo(() => formatRequestArgs(requestArgs), [requestArgs]);

    return (
      <Flexbox gap={8}>
        <div className={styles.notice}>
          <Icon className={styles.icon} icon={AlertTriangle} size={14} />
          <span className={styles.title}>{t('tool.intervention.renderFallback.title')}</span>
          <span className={styles.description}>
            {t('tool.intervention.renderFallback.description')}
          </span>
        </div>
        <Text fontSize={12} type="secondary">
          {identifier} / {apiName} · {t('tool.intervention.renderFallback.rawJson')}
        </Text>
        <Highlighter wrap actionIconSize="small" language="json" variant="borderless">
          {json}
        </Highlighter>
      </Flexbox>
    );
  },
);

UserInterventionFallback.displayName = 'UserInterventionFallback';

class UserInterventionErrorBoundary extends Component<
  UserInterventionErrorBoundaryProps,
  UserInterventionErrorBoundaryState
> {
  public state: UserInterventionErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): UserInterventionErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[UserInterventionErrorBoundary] Caught error in intervention render:', {
      apiName: this.props.apiName,
      componentStack: errorInfo.componentStack,
      error: error.message,
      identifier: this.props.identifier,
      toolCallId: this.props.toolCallId,
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <UserInterventionFallback
          apiName={this.props.apiName}
          identifier={this.props.identifier}
          requestArgs={this.props.requestArgs}
        />
      );
    }

    return this.props.children;
  }
}

export default UserInterventionErrorBoundary;
