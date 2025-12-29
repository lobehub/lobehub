import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BotIcon, ImageIcon, MicroscopeIcon, PenLineIcon, UsersIcon, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 6px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const modeConfig = {
  agent: { icon: BotIcon, titleKey: 'starter.createAgent' },
  group: { icon: UsersIcon, titleKey: 'starter.createGroup' },
  image: { icon: ImageIcon, titleKey: 'starter.image' },
  research: { icon: MicroscopeIcon, titleKey: 'starter.deepResearch' },
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
    <Flexbox align="center" className={styles.container} horizontal justify="space-between">
      <Flexbox align="center" gap={6} horizontal>
        <Icon color={cssVar.colorPrimary} size={14} />
        <span className={styles.title}>{t(config.titleKey)}</span>
      </Flexbox>
      <ActionIcon icon={X} onClick={clearInputMode} size="small" />
    </Flexbox>
  );
});

export default ModeHeader;
