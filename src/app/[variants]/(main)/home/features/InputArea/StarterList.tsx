import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { Button, type ButtonProps, Center, Tooltip } from '@lobehub/ui';
import { GroupBotSquareIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { BotIcon, FilePenIcon, ImageIcon, MicroscopeIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useInitBuiltinAgent } from '@/hooks/useInitBuiltinAgent';
import { type StarterMode, useHomeStore } from '@/store/home';

const styles = createStaticStyles(({ css, cssVar }) => ({
  active: css`
    border-color: ${cssVar.colorFillSecondary} !important;
    background: ${cssVar.colorBgElevated} !important;
  `,
  button: css`
    height: 40px;
    border-color: ${cssVar.colorFillSecondary};
    background: transparent;
    box-shadow: none !important;

    &:hover {
      border-color: ${cssVar.colorFillSecondary} !important;
      background: ${cssVar.colorBgElevated} !important;
    }
  `,
}));

type StarterTitleKey =
  | 'starter.createAgent'
  | 'starter.createGroup'
  | 'starter.write'
  | 'starter.image'
  | 'starter.deepResearch';

interface StarterItem {
  disabled?: boolean;
  icon?: ButtonProps['icon'];
  key: StarterMode;
  titleKey: StarterTitleKey;
}

const StarterList = memo(() => {
  const navigate = useNavigate();
  const { t } = useTranslation('home');

  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.agentBuilder);
  useInitBuiltinAgent(BUILTIN_AGENT_SLUGS.groupAgentBuilder);

  const [inputActiveMode, setInputActiveMode] = useHomeStore((s) => [
    s.inputActiveMode,
    s.setInputActiveMode,
  ]);

  const items: StarterItem[] = useMemo(
    () => [
      {
        icon: BotIcon,
        key: 'agent',
        titleKey: 'starter.createAgent',
      },
      {
        icon: GroupBotSquareIcon,
        key: 'group',
        titleKey: 'starter.createGroup',
      },
      {
        icon: FilePenIcon,
        key: 'write',
        titleKey: 'starter.write',
      },
      {
        icon: ImageIcon,
        key: 'image',
        titleKey: 'starter.image',
      },
      // {
      //   disabled: true,
      //   icon: MicroscopeIcon,
      //   key: 'research',
      //   titleKey: 'starter.deepResearch',
      // },
    ],
    [],
  );

  const handleClick = useCallback(
    (key: StarterMode) => {
      // Special case: image mode navigates to /image page
      if (key === 'image') {
        navigate('/image');
        return;
      }

      // Special case: write mode navigates to /page
      if (key === 'write') {
        navigate('/page');
        return;
      }

      // Toggle mode: if clicking the active mode, clear it; otherwise set it
      if (inputActiveMode === key) {
        setInputActiveMode(null);
      } else {
        setInputActiveMode(key);
      }
    },
    [inputActiveMode, setInputActiveMode, navigate],
  );

  return (
    <Center gap={8} horizontal>
      {items.map((item) => {
        const button = (
          <Button
            className={cx(styles.button, inputActiveMode === item.key && styles.active)}
            disabled={item.disabled}
            icon={item.icon}
            iconProps={{
              color: inputActiveMode === item.key ? cssVar.colorText : cssVar.colorTextSecondary,
              size: 18,
            }}
            key={item.key}
            onClick={() => handleClick(item.key)}
            shape={'round'}
            variant={'outlined'}
          >
            {t(item.titleKey)}
          </Button>
        );

        if (item.disabled) {
          return (
            <Tooltip key={item.key} title={t('starter.developing')}>
              {button}
            </Tooltip>
          );
        }

        return button;
      })}
    </Center>
  );
});

export default StarterList;
