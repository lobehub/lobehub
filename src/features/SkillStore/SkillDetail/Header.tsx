'use client';

import { Avatar, Flexbox, Icon, Text, useModalContext } from '@lobehub/ui';
import { Button } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2, Plus, SquareArrowOutUpRight } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useSkillConnect } from '@/features/SkillStore/SkillList/LobeHub/useSkillConnect';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { useDetailContext } from './DetailContext';
import { ICON_SIZE, styles } from './styles';

// Check if a string is likely an emoji or short text (not a URL or icon component)
const isEmojiOrText = (str: string): boolean => {
  // If it starts with http/https or contains common image extensions, it's a URL
  if (/^https?:\/\//.test(str) || /\.(?:png|jpg|jpeg|gif|svg|webp)$/i.test(str)) {
    return false;
  }
  // Short strings (<=4 chars) are likely emojis or short text
  return str.length <= 4;
};

interface HeaderProps {
  type: 'builtin' | 'klavis' | 'lobehub';
}

const Header = memo<HeaderProps>(({ type }) => {
  const { t } = useTranslation(['setting']);
  const { close } = useModalContext();
  const { identifier, serverName, icon, label, localizedDescription, isConnected } =
    useDetailContext();

  // Only use skill connect hook for non-builtin types
  const isBuiltin = type === 'builtin';
  const {
    handleConnect,
    isConnecting,
    isConnected: hookIsConnected,
  } = useSkillConnect({
    identifier,
    serverName,
    type: isBuiltin ? 'lobehub' : type, // Use lobehub as fallback for builtin
  });

  // Builtin tool installation state (global, stored in tool store)
  const [installBuiltinTool, isBuiltinInstalled] = useToolStore((s) => [
    s.installBuiltinTool,
    builtinToolSelectors.isBuiltinToolInstalled(identifier)(s),
  ]);

  const handleBuiltinInstall = async () => {
    await installBuiltinTool(identifier);
    close();
  };

  const hasTriggeredConnectRef = useRef(false);

  useEffect(() => {
    if (!isBuiltin && hasTriggeredConnectRef.current && hookIsConnected) {
      close();
    }
  }, [hookIsConnected, close, isBuiltin]);

  const handleConnectWithTracking = async () => {
    hasTriggeredConnectRef.current = true;
    await handleConnect();
  };

  const renderIcon = () => {
    if (typeof icon === 'string') {
      // Use Avatar for emoji/text avatars, img for URLs
      if (isEmojiOrText(icon)) {
        return <Avatar avatar={icon} size={ICON_SIZE} />;
      }
      return (
        <img
          alt={label}
          src={icon}
          style={{ maxHeight: ICON_SIZE, maxWidth: ICON_SIZE, objectFit: 'contain' }}
        />
      );
    }
    return <Icon fill={cssVar.colorText} icon={icon as any} size={ICON_SIZE} />;
  };

  const renderConnectButton = () => {
    // Handle builtin tools - only show install button, uninstall is done in settings
    if (isBuiltin) {
      if (isBuiltinInstalled) return null;

      return (
        <Button icon={<Icon icon={Plus} />} type="primary" onClick={handleBuiltinInstall}>
          {t('tools.builtins.install')}
        </Button>
      );
    }

    // Handle Klavis/LobeHub skills
    if (isConnected) return null;

    if (isConnecting) {
      return (
        <Button disabled icon={<Icon spin icon={Loader2} />} type="default">
          {t('tools.klavis.connect', { defaultValue: 'Connect' })}
        </Button>
      );
    }

    return (
      <Button
        icon={<Icon icon={SquareArrowOutUpRight} />}
        type="primary"
        onClick={handleConnectWithTracking}
      >
        {t('tools.klavis.connect', { defaultValue: 'Connect' })}
      </Button>
    );
  };

  return (
    <Flexbox
      horizontal
      align="center"
      className={styles.header}
      justify="space-between"
      style={{ flexWrap: 'nowrap' }}
    >
      <Flexbox horizontal align="center" gap={16}>
        <div className={styles.icon}>{renderIcon()}</div>
        <Flexbox gap={4}>
          <span className={styles.title}>{label}</span>
          <Text style={{ fontSize: 14 }} type="secondary">
            {localizedDescription}
          </Text>
        </Flexbox>
      </Flexbox>
      {renderConnectButton()}
    </Flexbox>
  );
});

export default Header;
