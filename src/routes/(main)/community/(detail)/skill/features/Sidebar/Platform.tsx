'use client';

import { DEFAULT_INBOX_AVATAR, SESSION_CHAT_URL } from '@lobechat/const';
import { Claude, Cline, Cursor, OpenAI } from '@lobehub/icons';
import {
  Avatar,
  Block,
  Button,
  Flexbox,
  Highlighter,
  Icon,
  Markdown,
  Segmented,
  Select,
  Text,
} from '@lobehub/ui';
import { Divider } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { BotIcon, UserRoundIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import Title from '../../../../components/Title';
import VsCodeIcon from './VsCodeIcon';

type GuideMode = 'agent' | 'human';

enum PlatformType {
  Claude = 'claude',
  Cline = 'cline',
  Codex = 'codex',
  Cursor = 'cursor',
  LobeHub = 'lobehub',
  VsCode = 'vscode',
}

export const styles = createStaticStyles(({ css }) => ({
  lite: css`
    pre {
      padding: 12px !important;
    }
  `,
}));

interface PlatformProps {
  downloadUrl?: string;
  expandCodeByDefault?: boolean;
  identifier?: string;
  lite?: boolean;
  mobile?: boolean;
}

const genInstallCommand = (identifier?: string, platform?: PlatformType) => {
  const id = identifier || '<skill-identifier>';

  const agentMap: Record<PlatformType, string> = {
    [PlatformType.Claude]: 'claude-code',
    [PlatformType.Cline]: 'cline',
    [PlatformType.Cursor]: 'cursor',
    [PlatformType.LobeHub]: 'lobehub',
    [PlatformType.Codex]: 'codex',
    [PlatformType.VsCode]: 'vscode',
  };

  switch (platform) {
    case PlatformType.Cursor:
    case PlatformType.Claude:
    case PlatformType.Cline:
    case PlatformType.VsCode: {
      return `npx -y @lobehub/market-cli skills install ${id} --agent ${agentMap[platform]}`;
    }
    case PlatformType.Codex: {
      return `npx -y @lobehub/market-cli skills install ${id} --agent ${agentMap[platform]}`;
    }
    default: {
      return `# Recommended for LobeHub users:
# Open the marketplace page and install with one click:
# https://lobechat.com/community/skills/${id}`;
    }
  }
};

const genLayout = (
  identifier: string | undefined,
  platform: PlatformType,
  i18nText: {
    lobehub: string;
    resourcesHint: string;
  },
) => {
  const id = identifier || '<skill-identifier>';
  const basePathMap: Record<PlatformType, string> = {
    [PlatformType.Claude]: `~/.claude/skills/${id}`,
    [PlatformType.Cline]: `~/.cline/skills/${id}`,
    [PlatformType.Cursor]: `~/.cursor/skills/${id}`,
    [PlatformType.LobeHub]: `<managed-by-lobehub>`,
    [PlatformType.Codex]: `~/.agents/skills/${id}`,
    [PlatformType.VsCode]: `./.vscode/skills/${id}`,
  };
  const basePath = basePathMap[platform];

  if (platform === PlatformType.LobeHub) {
    return i18nText.lobehub;
  }

  return `${basePath}
├── SKILL.md
└── ... (${i18nText.resourcesHint})`;
};

const Platform = memo<PlatformProps>(
  ({ lite, identifier, mobile, expandCodeByDefault, downloadUrl }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const sendMessage = useChatStore((s) => s.sendMessage);
    const [active, setActive] = useState<PlatformType>(PlatformType.Claude);
    const [mode, setMode] = useState<GuideMode>('agent');

    const options = [
      {
        icon: <Claude.Color className={'anticon'} size={18} />,
        label: 'Claude Code',
        value: PlatformType.Claude,
      },
      {
        icon: <OpenAI className={'anticon'} size={18} />,
        label: 'Codex',
        value: PlatformType.Codex,
      },
      {
        icon: <Cursor className={'anticon'} size={18} />,
        label: 'Cursor',
        value: PlatformType.Cursor,
      },
      {
        icon: <VsCodeIcon className={'anticon'} size={18} />,
        label: 'VsCode',
        value: PlatformType.VsCode,
      },
      {
        icon: <Cline className={'anticon'} size={18} />,
        label: 'Cline',
        value: PlatformType.Cline,
      },
    ];

    const { platform, steps } = useMemo(() => {
      switch (active) {
        case PlatformType.LobeHub: {
          return {
            platform: 'LobeHub',
            steps: t('skills.details.sidebar.platform.steps.lobehub'),
          };
        }
        case PlatformType.Claude: {
          return {
            platform: 'Claude',
            steps: t('skills.details.sidebar.platform.steps.claude'),
          };
        }
        case PlatformType.Codex: {
          return {
            platform: 'Codex',
            steps: t('skills.details.sidebar.platform.steps.codex'),
          };
        }
        case PlatformType.Cursor: {
          return {
            platform: 'Cursor',
            steps: t('skills.details.sidebar.platform.steps.cursor'),
          };
        }
        case PlatformType.Cline: {
          return {
            platform: 'Cline',
            steps: t('skills.details.sidebar.platform.steps.cline'),
          };
        }
        case PlatformType.VsCode: {
          return {
            platform: 'VS Code',
            steps: t('skills.details.sidebar.platform.steps.vscode'),
          };
        }
      }
    }, [active, t]);

    const command = genInstallCommand(identifier, active);

    const agentPrompt = `Curl https://lobehub.com/skills/${identifier}/skill.md, then follow the instructions to set up LobeHub Skills Marketplace and install the skill. Once installed, read the SKILL.md file in the installed directory and follow its instructions to complete the task.`;

    const handleUseOnLobeAI = useCallback(() => {
      if (!inboxAgentId) return;

      // Send message to LobeAI
      sendMessage({
        context: { agentId: inboxAgentId },
        message: agentPrompt,
      });

      // Navigate to LobeAI chat session
      navigate(SESSION_CHAT_URL(inboxAgentId, mobile));
    }, [agentPrompt, inboxAgentId, mobile, navigate, sendMessage]);

    return (
      <Block gap={lite ? 0 : 16} padding={4} variant={lite ? 'outlined' : 'borderless'}>
        <Segmented
          block
          style={{ marginBottom: 8 }}
          value={mode}
          variant={'filled'}
          options={[
            {
              icon: <Icon icon={BotIcon} />,
              label: t('skills.hero.guide.agent'),
              value: 'agent',
            },
            {
              icon: <Icon icon={UserRoundIcon} />,
              label: t('skills.hero.guide.human'),
              value: 'human',
            },
          ]}
          onChange={(value) => setMode(value as GuideMode)}
        />

        {mode === 'agent' ? (
          <Flexbox gap={mobile || lite ? 0 : 16}>
            {mobile || lite ? (
              <Text align={'center'} as={'h3'} fontSize={14} style={{ padding: 8 }} weight={500}>
                {t('skills.details.sidebar.agent.title')}
              </Text>
            ) : (
              <Title>{t('skills.details.sidebar.agent.title')}</Title>
            )}
            <Highlighter
              fullFeatured
              wrap
              className={cx(lite && styles.lite)}
              defaultExpand={expandCodeByDefault ?? false}
              fileName={'Agent prompt'}
              language={'bash'}
              style={{ fontSize: 12 }}
              variant={lite ? 'borderless' : 'outlined'}
            >
              {agentPrompt}
            </Highlighter>
            <Flexbox padding={8}>
              <Button
                block
                icon={<Avatar avatar={DEFAULT_INBOX_AVATAR} size={18} />}
                size={'large'}
                type={'primary'}
                onClick={handleUseOnLobeAI}
              >
                {t('skills.details.sidebar.agent.useOnLobeAI')}
              </Button>
            </Flexbox>
          </Flexbox>
        ) : (
          <>
            {mobile || lite ? (
              <Select
                value={active}
                variant={'filled'}
                options={options.map((item) => ({
                  ...item,
                  label: (
                    <Flexbox horizontal align={'center'} gap={8}>
                      {item.icon} {item.label}
                    </Flexbox>
                  ),
                }))}
                onSelect={(v) => setActive(v as PlatformType)}
              />
            ) : (
              <Segmented
                block
                options={options}
                value={active}
                onChange={(v) => setActive(v as PlatformType)}
              />
            )}
            <Flexbox>
              {!lite && <Title>{t('skills.details.sidebar.platform.title', { platform })}</Title>}
              <Markdown variant={'chat'}>{steps}</Markdown>
            </Flexbox>
            {lite && <Divider dashed style={{ margin: 0 }} />}
            <Highlighter
              fullFeatured
              className={cx(lite && styles.lite)}
              defaultExpand={expandCodeByDefault ?? false}
              fileName={t('skills.details.sidebar.installCommand')}
              language={'bash'}
              style={{ fontSize: 12 }}
              variant={lite ? 'borderless' : 'outlined'}
            >
              {command}
            </Highlighter>
            {lite && <Divider dashed style={{ margin: 0 }} />}
            <Highlighter
              fullFeatured
              className={cx(lite && styles.lite)}
              defaultExpand={false}
              fileName={t('skills.details.sidebar.directoryLayout')}
              language={'text'}
              style={{ fontSize: 12 }}
              variant={lite ? 'borderless' : 'outlined'}
            >
              {genLayout(identifier, active, {
                lobehub: t('skills.details.sidebar.platform.layout.lobehub'),
                resourcesHint: t('skills.details.sidebar.platform.layout.resourcesHint'),
              })}
            </Highlighter>
            {downloadUrl && (
              <>
                <Divider dashed style={{ margin: 0 }} />
                <Flexbox padding={8}>
                  <Button
                    block
                    href={downloadUrl}
                    size={'large'}
                    target={'_blank'}
                    type={'primary'}
                  >
                    {t('skills.details.sidebar.downloadSkill')}
                  </Button>
                </Flexbox>
              </>
            )}
          </>
        )}
      </Block>
    );
  },
);

export default Platform;
