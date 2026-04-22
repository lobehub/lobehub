'use client';

import { isDesktop } from '@lobechat/const';
import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import {
  CODEX_CLI_INSTALL_COMMANDS,
  CODEX_CLI_INSTALL_DOCS_URL,
} from '@lobechat/electron-client-ipc';
import { Alert, Button, Flexbox, Snippet, Text } from '@lobehub/ui';
import { ExternalLink, Settings2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

interface CodexCLIInstallGuideProps {
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
  variant?: 'compact' | 'inline';
}

const CodexCLIInstallGuide = memo<CodexCLIInstallGuideProps>(
  ({ error, onOpenSystemTools, variant = 'inline' }) => {
    const { t } = useTranslation('chat');
    const docsUrl = error?.docsUrl || CODEX_CLI_INSTALL_DOCS_URL;
    const installCommands = error?.installCommands?.length
      ? error.installCommands
      : CODEX_CLI_INSTALL_COMMANDS;
    const [recommendedCommand, alternativeCommand] = installCommands;

    const content = (
      <Flexbox gap={12}>
        <Text type="secondary">{t('codexInstallGuide.desc')}</Text>
        {error?.message && (
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('codexInstallGuide.reason', { message: error.message })}
          </Text>
        )}

        {recommendedCommand && (
          <Flexbox gap={6}>
            <Text strong style={{ fontSize: 12 }}>
              {t('codexInstallGuide.installWithNpm')}
            </Text>
            <Snippet language={'bash'}>{recommendedCommand}</Snippet>
          </Flexbox>
        )}

        {alternativeCommand && (
          <Flexbox gap={6}>
            <Text strong style={{ fontSize: 12 }}>
              {t('codexInstallGuide.installWithBrew')}
            </Text>
            <Snippet language={'bash'}>{alternativeCommand}</Snippet>
          </Flexbox>
        )}

        <Text style={{ fontSize: 12 }} type="secondary">
          {t('codexInstallGuide.afterInstall')}
        </Text>

        <Flexbox horizontal gap={8} justify="flex-end" style={{ flexWrap: 'wrap' }}>
          {onOpenSystemTools && (
            <Button icon={<Settings2 size={14} />} size="small" onClick={onOpenSystemTools}>
              {t('codexInstallGuide.actions.openSystemTools')}
            </Button>
          )}
          <Button
            icon={<ExternalLink size={14} />}
            size="small"
            type="primary"
            onClick={() => {
              const openLink = isDesktop
                ? electronSystemService.openExternalLink(docsUrl)
                : Promise.resolve(window.open(docsUrl, '_blank', 'noopener,noreferrer'));

              openLink.catch(console.error);
            }}
          >
            {t('codexInstallGuide.actions.openDocs')}
          </Button>
        </Flexbox>
      </Flexbox>
    );

    if (variant === 'compact') return content;

    return (
      <Alert
        extraDefaultExpand
        showIcon
        description={content}
        title={t('codexInstallGuide.title')}
        type={'warning'}
      />
    );
  },
);

CodexCLIInstallGuide.displayName = 'CodexCLIInstallGuide';

export default CodexCLIInstallGuide;
