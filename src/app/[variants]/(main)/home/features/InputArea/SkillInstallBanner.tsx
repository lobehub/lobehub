'use client';

import { getKlavisServerByServerIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Blocks } from 'lucide-react';
import React, { createElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { createSkillStoreModal } from '@/features/SkillStore';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';

const ICON_SIZE = 16;
const AVATAR_SIZE = 24;

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: ${AVATAR_SIZE}px;
    height: ${AVATAR_SIZE}px;
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
    box-shadow:
      0 0 8px -2px rgb(0 0 0 / 5%),
      0 0 0 1px ${cssVar.colorFillTertiary};
  `,
  banner: css`
    cursor: pointer;

    position: absolute;
    z-index: 0;
    inset-block-end: 0;
    inset-inline: 0;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    margin-block-end: 6px;
    padding-block: 42px 10px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: 20px;

    background: color-mix(in srgb, ${cssVar.colorFillQuaternary} 50%, ${cssVar.colorBgContainer});
  `,
  icon: css`
    color: ${cssVar.colorTextSecondary};
  `,
  iconGroup: css`
    display: flex;
    align-items: center;
  `,
  text: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const BANNER_SKILL_IDS = [
  { id: 'gmail', type: 'klavis' },
  { id: 'google-drive', type: 'klavis' },
  { id: 'google-calendar', type: 'klavis' },
  { id: 'slack', type: 'klavis' },
  { id: 'notion', type: 'klavis' },
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

  const skillIcons = useMemo(() => {
    const icons: Array<{ icon: string | React.ComponentType<{ size?: number }>; key: string }> = [];

    for (const skill of BANNER_SKILL_IDS) {
      if (skill.type === 'lobehub') {
        const provider = getLobehubSkillProviderById(skill.id);
        if (provider) {
          icons.push({ icon: provider.icon, key: provider.id });
        }
      } else {
        const server = getKlavisServerByServerIdentifier(skill.id);
        if (server) {
          icons.push({ icon: server.icon, key: server.identifier });
        }
      }
    }

    return icons;
  }, []);

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  return (
    <div className={styles.banner} onClick={handleOpenStore}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon className={styles.icon} icon={Blocks} size={18} />
        <span className={styles.text}>{t('skillInstallBanner.title')}</span>
      </Flexbox>
      {skillIcons.length > 0 && (
        <div className={styles.iconGroup}>
          {skillIcons.map(({ icon, key }, index) => (
            <div
              className={styles.avatar}
              key={key}
              style={{ marginLeft: index === 0 ? 0 : -6, zIndex: index }}
            >
              {typeof icon === 'string' ? (
                <img alt={key} height={ICON_SIZE} src={icon} width={ICON_SIZE} />
              ) : (
                createElement(icon, { size: ICON_SIZE })
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

SkillInstallBanner.displayName = 'SkillInstallBanner';

export default SkillInstallBanner;
