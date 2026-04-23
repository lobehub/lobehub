'use client';

import { isDesktop } from '@lobechat/const';
import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import {
  CLAUDE_CODE_CLI_INSTALL_COMMANDS,
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_COMMANDS,
  CODEX_CLI_INSTALL_DOCS_URL,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';
import { ClaudeCode, Codex } from '@lobehub/icons';
import { Avatar, Block, Button, Flexbox, Highlighter, Snippet, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ExternalLink, Settings2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

const SUPPORTED_AGENT_TYPES = ['claude-code', 'codex'] as const;

type SupportedAgentType = (typeof SUPPORTED_AGENT_TYPES)[number];

const AGENT_INSTALL_GUIDE_CONFIG = {
  'claude-code': {
    docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
    icon: ClaudeCode,
    installCommands: CLAUDE_CODE_CLI_INSTALL_COMMANDS,
    signInCommand: 'claude',
    title: 'Claude Code',
    translationPrefix: 'claudeCodeInstallGuide',
  },
  'codex': {
    docsUrl: CODEX_CLI_INSTALL_DOCS_URL,
    icon: Codex,
    installCommands: CODEX_CLI_INSTALL_COMMANDS,
    signInCommand: 'codex',
    title: 'Codex',
    translationPrefix: 'codexInstallGuide',
  },
} as const satisfies Record<
  SupportedAgentType,
  {
    docsUrl: string;
    icon: typeof ClaudeCode;
    installCommands: readonly string[];
    signInCommand: string;
    title: string;
    translationPrefix: string;
  }
>;

const isSupportedAgentType = (value?: string): value is SupportedAgentType =>
  !!value && SUPPORTED_AGENT_TYPES.includes(value as SupportedAgentType);

interface CodexCLIInstallGuideProps {
  agentType?: string;
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
  variant?: 'compact' | 'embedded' | 'inline';
}

const CodexCLIInstallGuide = memo<CodexCLIInstallGuideProps>(
  ({ agentType = 'codex', error, onOpenSystemTools, variant = 'inline' }) => {
    const { t } = useTranslation('chat');
    const resolvedAgentType = isSupportedAgentType(error?.agentType)
      ? error.agentType
      : isSupportedAgentType(agentType)
        ? agentType
        : 'codex';
    const guideConfig = AGENT_INSTALL_GUIDE_CONFIG[resolvedAgentType];
    const AgentIcon = guideConfig.icon;
    const translationPrefix = guideConfig.translationPrefix;
    const docsUrl = error?.docsUrl || guideConfig.docsUrl;
    const isAuthRequired = error?.code === HeterogeneousAgentSessionErrorCode.AuthRequired;
    const installCommands = error?.installCommands?.length
      ? error.installCommands
      : guideConfig.installCommands;
    const rawErrorDetails = error?.stderr || error?.message;
    const [recommendedCommand, alternativeCommand] = installCommands;
    const showErrorReason =
      Boolean(error?.message) &&
      error?.code !== HeterogeneousAgentSessionErrorCode.AuthRequired &&
      error?.code !== HeterogeneousAgentSessionErrorCode.CliNotFound;
    const showRawErrorDetails = isAuthRequired && Boolean(rawErrorDetails);
    const showHeader = variant !== 'embedded';
    const title = isAuthRequired
      ? t('cliAuthGuide.title', { name: guideConfig.title })
      : t(`${translationPrefix}.title`);
    const description = isAuthRequired
      ? t('cliAuthGuide.desc', { name: guideConfig.title })
      : t(`${translationPrefix}.desc`);
    const footerText = isAuthRequired
      ? t('cliAuthGuide.afterLogin')
      : t(`${translationPrefix}.afterInstall`);
    const openDocsLabel = isAuthRequired
      ? t('cliAuthGuide.actions.openDocs')
      : t(`${translationPrefix}.actions.openDocs`);
    const openSystemToolsLabel = isAuthRequired
      ? t('cliAuthGuide.actions.openSystemTools')
      : t(`${translationPrefix}.actions.openSystemTools`);

    const content = (
      <Flexbox gap={12}>
        {showHeader ? (
          <Flexbox horizontal align="center" gap={12}>
            <Avatar
              avatar={<AgentIcon size={24} />}
              background={cssVar.colorFillQuaternary}
              gap={12}
              shape={'square'}
              size={48}
            />
            <Flexbox gap={4}>
              <Text style={{ fontSize: 16, fontWeight: 600 }}>{title}</Text>
              <Text type="secondary">{description}</Text>
            </Flexbox>
          </Flexbox>
        ) : (
          <Text type="secondary">{description}</Text>
        )}

        {showErrorReason && (
          <Text style={{ fontSize: 12 }} type="secondary">
            {t(`${translationPrefix}.reason`, { message: error.message })}
          </Text>
        )}

        {isAuthRequired ? (
          <Flexbox gap={6}>
            <Text strong style={{ fontSize: 12 }}>
              {t('cliAuthGuide.runCommand')}
            </Text>
            <Snippet language={'bash'}>{guideConfig.signInCommand}</Snippet>
          </Flexbox>
        ) : (
          recommendedCommand && (
            <Flexbox gap={6}>
              <Text strong style={{ fontSize: 12 }}>
                {t(`${translationPrefix}.installWithNpm`)}
              </Text>
              <Snippet language={'bash'}>{recommendedCommand}</Snippet>
            </Flexbox>
          )
        )}

        {!isAuthRequired && alternativeCommand && (
          <Flexbox gap={6}>
            <Text strong style={{ fontSize: 12 }}>
              {t(`${translationPrefix}.installWithBrew`)}
            </Text>
            <Snippet language={'bash'}>{alternativeCommand}</Snippet>
          </Flexbox>
        )}

        <Text style={{ fontSize: 12 }} type="secondary">
          {footerText}
        </Text>

        {showRawErrorDetails && (
          <Flexbox gap={6}>
            <Text strong style={{ fontSize: 12 }}>
              {t('cliAuthGuide.errorDetails')}
            </Text>
            <Highlighter
              wrap
              actionIconSize={'small'}
              language={'log'}
              padding={12}
              variant={'outlined'}
              style={{
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {rawErrorDetails}
            </Highlighter>
          </Flexbox>
        )}

        <Flexbox horizontal gap={8} justify="flex-end" style={{ flexWrap: 'wrap' }}>
          {onOpenSystemTools && (
            <Button icon={<Settings2 size={14} />} size="small" onClick={onOpenSystemTools}>
              {openSystemToolsLabel}
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
            {openDocsLabel}
          </Button>
        </Flexbox>
      </Flexbox>
    );

    if (variant !== 'inline') return content;

    return (
      <Block
        gap={16}
        padding={16}
        variant={'outlined'}
        style={{
          background: cssVar.colorBgElevated,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        {content}
      </Block>
    );
  },
);

CodexCLIInstallGuide.displayName = 'CodexCLIInstallGuide';

export default CodexCLIInstallGuide;
