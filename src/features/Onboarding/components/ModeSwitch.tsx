'use client';

import { isDesktop } from '@lobechat/const';
import { ActionIcon, Flexbox, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { useServerConfigStore } from '@/store/serverConfig';

const COLLAPSED_STORAGE_KEY = 'LOBE_ONBOARDING_MODE_SWITCH_COLLAPSED';

const styles = createStaticStyles(({ css, cssVar }) => ({
  anchor: css`
    position: fixed;
    z-index: 10;
    inset-block-end: 24px;
    inset-inline-end: 24px;

    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
  `,
  anchorWithLabel: css`
    align-items: stretch;
  `,
  pill: css`
    display: flex;
    flex-flow: row wrap;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;

    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid color-mix(in srgb, ${cssVar.colorBorderSecondary} 60%, transparent);
    border-radius: 999px;

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 75%, transparent);
    backdrop-filter: blur(16px) saturate(1.2);
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  pillCollapsed: css`
    padding-block: 4px;
    padding-inline: 4px;
  `,
}));

interface ModeSwitchProps {
  actions?: ReactNode;
  className?: string;
  showLabel?: boolean;
  style?: CSSProperties;
}

const ModeSwitch = memo<ModeSwitchProps>(({ actions, className, showLabel = false, style }) => {
  const { t } = useTranslation('onboarding');
  const location = useLocation();
  const navigate = useNavigate();
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const mode = useMemo(() => {
    return location.pathname.startsWith('/onboarding/agent') ? 'agent' : 'classic';
  }, [location.pathname]);

  const options = useMemo(() => {
    if (isDesktop || !serverConfigInit || !enableAgentOnboarding) return [];

    return [
      { label: t('agent.modeSwitch.agent'), value: 'agent' as const },
      { label: t('agent.modeSwitch.classic'), value: 'classic' as const },
    ];
  }, [enableAgentOnboarding, serverConfigInit, t]);

  const segmented =
    options.length > 0 ? (
      <Segmented
        options={options}
        size={'small'}
        value={mode}
        onChange={(value) => {
          navigate(value === 'agent' ? '/onboarding/agent' : '/onboarding/classic');
        }}
      />
    ) : null;

  if (!segmented && !actions) return null;

  const collapseToggle = (
    <ActionIcon
      icon={collapsed ? ChevronLeft : ChevronRight}
      size={'small'}
      title={collapsed ? t('agent.modeSwitch.expand') : t('agent.modeSwitch.collapse')}
      onClick={() => setCollapsed((v) => !v)}
    />
  );

  return (
    <Flexbox
      style={style}
      className={cx(styles.anchor, showLabel && !collapsed && styles.anchorWithLabel, className)}
    >
      {showLabel && segmented && !collapsed && (
        <Text style={{ paddingInline: 4 }} type={'secondary'}>
          {t('agent.modeSwitch.label')}
        </Text>
      )}
      {actions ? (
        <div className={cx(styles.pill, collapsed && styles.pillCollapsed)}>
          {collapseToggle}
          {!collapsed && (
            <>
              {actions}
              {segmented}
            </>
          )}
        </div>
      ) : (
        segmented
      )}
    </Flexbox>
  );
});

ModeSwitch.displayName = 'OnboardingModeSwitch';

export default ModeSwitch;
