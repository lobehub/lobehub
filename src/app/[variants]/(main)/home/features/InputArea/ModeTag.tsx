import { ActionIcon, Block, Text } from '@lobehub/ui';
import { GroupBotSquareIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar } from 'antd-style';
import { BotIcon, FilePenIcon, ImageIcon, PenLineIcon, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-inline-start: 12px;
    border-radius: 16px;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const modeConfig = {
  agent: { icon: BotIcon, titleKey: 'starter.createAgent' },
  group: { icon: GroupBotSquareIcon, titleKey: 'starter.createGroup' },
  image: { icon: ImageIcon, titleKey: 'starter.image' },
  research: { icon: FilePenIcon, titleKey: 'starter.deepResearch' },
  write: { icon: PenLineIcon, titleKey: 'starter.write' },
} as const;

const ModeHeader = memo(() => {
  const { t } = useTranslation('home');

  const [inputActiveMode, clearInputMode] = useHomeStore((s) => [
    s.inputActiveMode,
    s.clearInputMode,
  ]);

  if (!inputActiveMode) return null;

  const config = modeConfig[inputActiveMode];
  const Icon = config.icon;

  return (
    <Block
      horizontal
      align="center"
      className={styles.container}
      gap={8}
      padding={4}
      variant={'filled'}
    >
      <Icon color={cssVar.colorTextDescription} size={16} />
      <Text fontSize={12} type={'secondary'}>
        {t(config.titleKey)}
      </Text>
      <ActionIcon
        icon={X}
        size="small"
        style={{
          borderRadius: 16,
        }}
        onClick={clearInputMode}
      />
    </Block>
  );
});

export default ModeHeader;
