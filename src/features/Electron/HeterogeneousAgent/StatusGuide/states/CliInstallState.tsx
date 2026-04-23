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

  return (
    <GuideShell
      headerDescription={<Text type="secondary">{t(`${translationPrefix}.desc`)}</Text>}
      icon={<config.icon size={24} />}
      title={t(`${translationPrefix}.title`)}
      variant={variant}
      actions={
        <GuideActions
          showDocs
          docsUrl={docsUrl}
          openDocsLabel={t(`${translationPrefix}.actions.openDocs`)}
          openSystemToolsLabel={t(`${translationPrefix}.actions.openSystemTools`)}
          onOpenSystemTools={onOpenSystemTools}
        />
      }
    >
      {showErrorReason && (
        <Text style={{ fontSize: 12 }} type="secondary">
          {t(`${translationPrefix}.reason`, { message: error?.message })}
        </Text>
      )}

      {recommendedCommand && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {t(`${translationPrefix}.installWithNpm`)}
          </Text>
          <Snippet language={'bash'}>{recommendedCommand}</Snippet>
        </Flexbox>
      )}

      {alternativeCommand && (
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 12 }}>
            {t(`${translationPrefix}.installWithBrew`)}
          </Text>
          <Snippet language={'bash'}>{alternativeCommand}</Snippet>
        </Flexbox>
      )}

      <Text style={{ fontSize: 12 }} type="secondary">
        {t(`${translationPrefix}.afterInstall`)}
      </Text>
    </GuideShell>
  );
};

export default CliInstallState;
