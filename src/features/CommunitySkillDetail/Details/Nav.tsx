'use client';

import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SkillNavKey } from '../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    cursor: pointer;

    position: relative;

    height: 42px;
    padding-block: 0;
    padding-inline: 12px;
    border: 0;
    border-radius: 8px;

    font: inherit;
    font-size: 15px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition:
      background 0.2s ease,
      color 0.2s ease;

    &::after {
      content: '';

      position: absolute;
      z-index: 1;
      inset-block-end: 0;
      inset-inline: 12px;
      transform: scaleX(0.4);

      height: 2px;
      border-radius: 999px;

      opacity: 0;
      background: ${cssVar.colorPrimary};

      transition:
        opacity 0.2s ease,
        transform 0.2s ease;
    }

    &:hover {
      color: ${cssVar.colorText};
      background: color-mix(in srgb, ${cssVar.colorFillQuaternary} 70%, transparent);
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorInfo};
      outline-offset: 2px;
    }
  `,
  itemActive: css`
    font-weight: 700;
    color: ${cssVar.colorText};
    background: color-mix(in srgb, ${cssVar.colorFillQuaternary} 76%, transparent);

    &::after {
      transform: scaleX(1);
      opacity: 1;
    }
  `,
  nav: css`
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;
    gap: 8px;

    width: 100%;
    padding-block-end: 8px;
    border-block-end: 1px solid color-mix(in srgb, ${cssVar.colorBorderSecondary} 88%, transparent);

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

const Nav = memo<{
  activeTab?: SkillNavKey;
  setActiveTab?: (tab: SkillNavKey) => void;
}>(({ setActiveTab, activeTab = SkillNavKey.Overview }) => {
  const { t } = useTranslation('discover');

  const items = [
    { key: SkillNavKey.Overview, label: t('skills.details.overview.title') },
    { key: SkillNavKey.Install, label: t('skills.details.nav.install') },
    { key: SkillNavKey.Reviews, label: t('skills.details.nav.reviews') },
    { key: SkillNavKey.Info, label: t('skills.details.nav.info') },
  ];

  return (
    <div className={styles.nav}>
      {items.map((item) => (
        <button
          key={item.key}
          type={'button'}
          className={[styles.item, activeTab === item.key ? styles.itemActive : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => setActiveTab?.(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
});

export default Nav;
