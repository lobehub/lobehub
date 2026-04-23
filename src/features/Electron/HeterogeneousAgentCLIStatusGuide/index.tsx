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
import { memo, useMemo } from 'react';
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

const extractTimezoneLabel = (value?: string) => {
  if (!value) return;

  const match = value.match(/\(([^()]+)\)\s*$/);
  return match?.[1];
};

interface HeterogeneousAgentCLIStatusGuideProps {
  agentType?: string;
  error?: HeterogeneousAgentSessionError | null;
  onOpenSystemTools?: () => void;
  variant?: 'compact' | 'embedded' | 'inline';
}

const HeterogeneousAgentCLIStatusGuide = memo<HeterogeneousAgentCLIStatusGuideProps>(
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
    const isRateLimit = error?.code === HeterogeneousAgentSessionErrorCode.RateLimit;
    const installCommands = error?.installCommands?.length
      ? error.installCommands
      : guideConfig.installCommands;
    const rawErrorDetails = error?.stderr || error?.message;
    const [recommendedCommand, alternativeCommand] = installCommands;
    const showErrorReason =
      Boolean(error?.message) &&
      error?.code !== HeterogeneousAgentSessionErrorCode.AuthRequired &&
      error?.code !== HeterogeneousAgentSessionErrorCode.CliNotFound &&
      error?.code !== HeterogeneousAgentSessionErrorCode.RateLimit;
    const showRawErrorDetails = isAuthRequired && Boolean(rawErrorDetails);
    const timezoneLabel = useMemo(
      () =>
        extractTimezoneLabel(rawErrorDetails) || Intl.DateTimeFormat().resolvedOptions().timeZone,
      [rawErrorDetails],
    );
    const formattedResetAt = useMemo(() => {
      const resetsAt = error?.rateLimitInfo?.resetsAt;
      if (!resetsAt) return;

      try {
        return new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          ...(timezoneLabel ? { timeZone: timezoneLabel } : {}),
          weekday: 'short',
        }).format(new Date(resetsAt * 1000));
      } catch {
        try {
          return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(resetsAt * 1000));
        } catch {
          return;
        }
      }
    }, [error?.rateLimitInfo?.resetsAt, timezoneLabel]);
    const rateLimitTypeLabel = useMemo(() => {
      const rateLimitType = error?.rateLimitInfo?.rateLimitType;
      if (!rateLimitType) return;

      if (rateLimitType === 'seven_day') {
        return t('cliRateLimitGuide.limitTypes.weekCycle');
      }

      return rateLimitType.replaceAll('_', ' ');
    }, [error?.rateLimitInfo?.rateLimitType, t]);
    const relativeResetText = useMemo(() => {
      const resetsAt = error?.rateLimitInfo?.resetsAt;
      if (!resetsAt) return;

      const now = Date.now();
      const diffMs = Math.max(0, resetsAt * 1000 - now);
      const totalMinutes = Math.floor(diffMs / 60_000);

      if (totalMinutes <= 0) return t('cliRateLimitGuide.relative.soon');

      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const minutes = totalMinutes % 60;
      const parts: string[] = [];

      if (days > 0) parts.push(t('cliRateLimitGuide.relative.day', { count: days }));
      if (hours > 0) parts.push(t('cliRateLimitGuide.relative.hour', { count: hours }));
      if (minutes > 0 && parts.length < 2) {
        parts.push(t('cliRateLimitGuide.relative.minute', { count: minutes }));
      }

      return parts.length > 0
        ? t('cliRateLimitGuide.resetInApprox', { duration: parts.slice(0, 2).join(' ') })
        : t('cliRateLimitGuide.relative.soon');
    }, [error?.rateLimitInfo?.resetsAt, t]);
    const showHeader = variant !== 'embedded';
    const title = isAuthRequired
      ? t('cliAuthGuide.title', { name: guideConfig.title })
      : isRateLimit
        ? t('cliRateLimitGuide.title', { name: guideConfig.title })
        : t(`${translationPrefix}.title`);
    const description = isAuthRequired
      ? t('cliAuthGuide.desc', { name: guideConfig.title })
      : t(`${translationPrefix}.desc`);
    const footerText = isAuthRequired
      ? t('cliAuthGuide.afterLogin')
      : isRateLimit
        ? t('cliRateLimitGuide.afterReset')
        : t(`${translationPrefix}.afterInstall`);
    const openDocsLabel = isAuthRequired
      ? t('cliAuthGuide.actions.openDocs')
      : t(`${translationPrefix}.actions.openDocs`);
    const openSystemToolsLabel = isAuthRequired
      ? t('cliAuthGuide.actions.openSystemTools')
      : isRateLimit
        ? t('cliRateLimitGuide.actions.openSystemTools')
        : t(`${translationPrefix}.actions.openSystemTools`);
    const rateLimitSummary = isRateLimit ? <Text type="secondary">{footerText}</Text> : null;

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
              {isRateLimit ? rateLimitSummary : <Text type="secondary">{description}</Text>}
            </Flexbox>
          </Flexbox>
        ) : isRateLimit ? (
          rateLimitSummary
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
        ) : isRateLimit ? (
          <Flexbox gap={8}>
            {formattedResetAt && (
              <Flexbox horizontal gap={8} style={{ alignItems: 'baseline' }}>
                <Text strong style={{ fontSize: 12 }}>
                  {t('cliRateLimitGuide.resetAt')}
                </Text>
                <Flexbox
                  horizontal
                  gap={8}
                  style={{ alignItems: 'baseline', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}
                >
                  <Text>{`${formattedResetAt}${timezoneLabel ? ` (${timezoneLabel})` : ''}`}</Text>
                  {relativeResetText && (
                    <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }} type="secondary">
                      {relativeResetText}
                    </Text>
                  )}
                </Flexbox>
              </Flexbox>
            )}

            {rateLimitTypeLabel && (
              <Flexbox horizontal align="center" gap={8}>
                <Text strong style={{ fontSize: 12 }}>
                  {t('cliRateLimitGuide.limitType')}
                </Text>
                <Text>{rateLimitTypeLabel}</Text>
              </Flexbox>
            )}
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

        {!isAuthRequired && !isRateLimit && alternativeCommand && (
          <Flexbox gap={6}>
            <Text strong style={{ fontSize: 12 }}>
              {t(`${translationPrefix}.installWithBrew`)}
            </Text>
            <Snippet language={'bash'}>{alternativeCommand}</Snippet>
          </Flexbox>
        )}

        {!isRateLimit && (
          <Text style={{ fontSize: 12 }} type="secondary">
            {footerText}
          </Text>
        )}

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
          {!isRateLimit && (
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
          )}
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

HeterogeneousAgentCLIStatusGuide.displayName = 'HeterogeneousAgentCLIStatusGuide';

export default HeterogeneousAgentCLIStatusGuide;
