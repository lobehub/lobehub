'use client';

import { KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import { Avatar, Flexbox, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Blocks } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkillStore from '@/features/SkillStore';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';

const useStyles = createStyles(({ css, token }) => ({
  banner: css`
    cursor: pointer;

    position: absolute;
    z-index: 0;
    inset-block-end: 0;
    inset-inline: 0 0;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    margin-block-end: 6px;
    padding-block: 42px 10px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 20px;

    background: ${token.colorFillQuaternary};
    box-shadow: 0 12px 32px rgb(0 0 0 / 4%);

    transition: background 0.2s ease-in-out;

    &:hover {
      background: ${token.colorFillQuaternary};
    }
  `,
  icon: css`
    color: ${token.colorTextSecondary};
  `,
  text: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
}));

const MAX_VISIBLE_ICONS = 7;

const SkillInstallBanner = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('plugin');
  const [open, setOpen] = useState(false);

  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);

  // Prefetch skill connections data so SkillStore opens faster
  const [useFetchLobehubSkillConnections, useFetchUserKlavisServers] = useToolStore((s) => [
    s.useFetchLobehubSkillConnections,
    s.useFetchUserKlavisServers,
  ]);
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);
  useFetchUserKlavisServers(isKlavisEnabled);

  // Build avatar items for Avatar.Group
  const avatarItems = useMemo(() => {
    const items: Array<{ avatar: string; key: string; title: string }> = [];

    if (isLobehubSkillEnabled) {
      for (const provider of LOBEHUB_SKILL_PROVIDERS.filter((p) => p.defaultVisible !== false)) {
        // Only include providers with URL icons (skip React component icons)
        if (typeof provider.icon === 'string') {
          items.push({
            avatar: provider.icon,
            key: provider.id,
            title: provider.label,
          });
        }
      }
    }

    if (isKlavisEnabled) {
      for (const server of KLAVIS_SERVER_TYPES) {
        // Only include servers with URL icons (skip React component icons)
        if (typeof server.icon === 'string') {
          items.push({
            avatar: server.icon,
            key: server.identifier,
            title: server.label,
          });
        }
      }
    }

    return items.slice(0, MAX_VISIBLE_ICONS);
  }, [isLobehubSkillEnabled, isKlavisEnabled]);

  // Don't show banner if no skills are enabled
  if (!isLobehubSkillEnabled && !isKlavisEnabled) return null;

  return (
    <>
      <div className={styles.banner} onClick={() => setOpen(true)}>
        <Flexbox align="center" gap={8} horizontal>
          <Icon className={styles.icon} icon={Blocks} size={18} />
          <span className={styles.text}>{t('skillInstallBanner.title')}</span>
        </Flexbox>
        {avatarItems.length > 0 && <Avatar.Group items={avatarItems} shape={'circle'} size={24} />}
      </div>
      <SkillStore onClose={() => setOpen(false)} open={open} />
    </>
  );
});

SkillInstallBanner.displayName = 'SkillInstallBanner';

export default SkillInstallBanner;
