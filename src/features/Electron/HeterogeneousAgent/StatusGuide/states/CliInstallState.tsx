import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { Flexbox, Snippet, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const CliInstallState = ({
  config,
  error,
  onOpenSystemTools,
  variant,
}: HeterogeneousAgentGuideStateProps) => {
  const { t } = useTranslation('chat');
  const translationPrefix = config.translationPrefix;
  const docsUrl = error?.docsUrl || config.docsUrl;
  const installCommands = error?.installCommands?.length
    ? error.installCommands
    : config.installCommands;
  const [recommendedCommand, alternativeCommand] = installCommands;
  const showErrorReason =
    Boolean(error?.message) && error?.code !== HeterogeneousAgentSessionErrorCode.CliNotFound;

  // `translationPrefix` is dynamic at runtime, so use the string-key overload
  // with `defaultValue` to satisfy the i18n key typing.
  const tKey = (suffix: string, options?: Record<string, unknown>) =>
    t(`${translationPrefix}.${suffix}`, { defaultValue: '', ...options });

  return (
    <GuideShell
      headerDescription={<Text type="secondary">{tKey('desc')}</Text>}
      icon={<config.icon size={24} />}
      title={tKey('title')}
      variant={variant}
      actions={
        <GuideActions
          showDocs
          docsUrl={docsUrl}
          openDocsLabel={tKey('actions.openDocs')}
          openSystemToolsLabel={tKey('actions.openSystemTools')}
          onOpenSystemTools={onOpenSystemTools}
        />
      }
    >
      {showErrorReason && (
        <Text style={{ fontSize: 12 }} type="secondary">
          {tKey('reason', { message: error?.message })}
        </Text>
      )}

      {recommendedCommand && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {tKey('installWithNpm')}
          </Text>
          <Snippet language={'bash'}>{recommendedCommand}</Snippet>
        </Flexbox>
      )}

      {alternativeCommand && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {tKey('installWithBrew')}
          </Text>
          <Snippet language={'bash'}>{alternativeCommand}</Snippet>
        </Flexbox>
      )}

      <Text style={{ fontSize: 12 }} type="secondary">
        {tKey('afterInstall')}
      </Text>
    </GuideShell>
  );
};

export default CliInstallState;
