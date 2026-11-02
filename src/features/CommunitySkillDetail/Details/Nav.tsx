'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SkillNavKey } from '../types';

const styles = stylex.create({
  item: {
    'cursor': 'pointer',
    'position': 'relative',
    'height': '42px',
    'paddingBlock': '0',
    'paddingInline': '12px',
    'borderStyle': 'none',
    'borderRadius': '8px',
    'font': 'inherit',
    'fontSize': '15px',
    'fontWeight': 500,
    'color': { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    'backgroundColor': {
      'default': 'transparent',
      ':hover': `color-mix(in srgb, ${cssVar.colorFillQuaternary} 70%, transparent)`,
    },
    'backgroundImage': { 'default': 'none', ':hover': 'none' },
    'transition': 'background 0.2s ease, color 0.2s ease',
    'outlineWidth': { 'default': null, ':focus-visible': '2px' },
    'outlineStyle': { 'default': null, ':focus-visible': 'solid' },
    'outlineColor': { 'default': null, ':focus-visible': cssVar.colorInfo },
    'outlineOffset': { 'default': null, ':focus-visible': '2px' },
    '::after': {
      content: "''",
      position: 'absolute',
      zIndex: 1,
      insetBlockEnd: '0',
      insetInline: '12px',
      transform: 'scaleX(0.4)',
      height: '2px',
      borderRadius: '999px',
      opacity: 0,
      backgroundColor: cssVar.colorPrimary,
      backgroundImage: 'none',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
    },
  },
  itemActive: {
    'fontWeight': 700,
    'color': cssVar.colorText,
    'backgroundColor': {
      'default': `color-mix(in srgb, ${cssVar.colorFillQuaternary} 76%, transparent)`,
      ':hover': `color-mix(in srgb, ${cssVar.colorFillQuaternary} 70%, transparent)`,
    },
    'backgroundImage': 'none',
    '::after': { transform: 'scaleX(1)', opacity: 1 },
  },
  nav: {
    'scrollbarWidth': 'none',
    'overflowX': 'auto',
    'display': 'flex',
    'gap': '8px',
    'width': '100%',
    'paddingBlockEnd': '8px',
    'borderBlockEndWidth': '1px',
    'borderBlockEndStyle': 'solid',
    'borderBlockEndColor': `color-mix(in srgb, ${cssVar.colorBorderSecondary} 88%, transparent)`,
    '::-webkit-scrollbar': { display: 'none' },
  },
});

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
    <div {...stylex.props(styles.nav)}>
      {items.map((item) => (
        <button
          key={item.key}
          type={'button'}
          {...stylex.props(styles.item, activeTab === item.key && styles.itemActive)}
          onClick={() => setActiveTab?.(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
});

export default Nav;
