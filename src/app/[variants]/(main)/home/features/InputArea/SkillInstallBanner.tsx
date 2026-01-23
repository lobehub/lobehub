'use client';

import { getKlavisServerByServerIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Avatar, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Blocks } from 'lucide-react';
import { type ReactNode, createElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { createSkillStoreModal } from '@/features/SkillStore';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 20px;

    background: ${cssVar.colorFillQuaternary};
    box-shadow: 0 12px 32px rgb(0 0 0 / 4%);

    transition: background 0.2s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  icon: css`
    color: ${cssVar.colorTextSecondary};
  `,
  text: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const BANNER_SKILL_IDS = [
  { id: 'gmail', type: 'klavis' },
  { id: 'notion', type: 'klavis' },
  { id: 'google-drive', type: 'klavis' },
  { id: 'google-calendar', type: 'klavis' },
  { id: 'slack', type: 'klavis' },
  { id: 'twitter', type: 'lobehub' },
  { id: 'github', type: 'klavis' },
] as const;

const SkillInstallBanner = memo(() => {
  const { t } = useTranslation('plugin');

  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);

  // Prefetch skill connections data so SkillStore opens faster
  const [useFetchLobehubSkillConnections, useFetchUserKlavisServers] = useToolStore((s) => [
    s.useFetchLobehubSkillConnections,
    s.useFetchUserKlavisServers,
  ]);
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);
  useFetchUserKlavisServers(isKlavisEnabled);

  const avatarItems = useMemo(() => {
    const items: Array<{ avatar: ReactNode; key: string; title: string }> = [];

    for (const skill of BANNER_SKILL_IDS) {
      if (skill.type === 'lobehub') {
        const provider = getLobehubSkillProviderById(skill.id);
        if (provider) {
          items.push({
            avatar:
              typeof provider.icon === 'string'
                ? provider.icon
                : createElement(provider.icon, { size: 14 }),
            key: provider.id,
            title: provider.label,
          });
        }
      } else {
        const server = getKlavisServerByServerIdentifier(skill.id);
        if (server) {
          items.push({
            avatar:
              typeof server.icon === 'string'
                ? server.icon
                : createElement(server.icon, { size: 14 }),
            key: server.identifier,
            title: server.label,
          });
        }
      }
    }

    return items;
  }, []);

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  // Don't show banner if no skills are enabled
  if (!isLobehubSkillEnabled && !isKlavisEnabled) return null;

  return (
    <div className={styles.banner} onClick={handleOpenStore}>
      <Flexbox align="center" gap={8} horizontal>
        <Icon className={styles.icon} icon={Blocks} size={18} />
        <span className={styles.text}>{t('skillInstallBanner.title')}</span>
      </Flexbox>
      {avatarItems.length > 0 && <Avatar.Group items={avatarItems} shape="circle" size={24} />}
    </div>
  );
});

SkillInstallBanner.displayName = 'SkillInstallBanner';

export default SkillInstallBanner;
