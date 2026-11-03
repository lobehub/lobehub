'use client';

import { Button, Flexbox, Icon, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { TriangleAlert, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MANUAL_UPGRADE_URL } from '@/const/url';
import { CURRENT_VERSION } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useGlobalStore } from '@/store/global';

const styles = stylex.create({
  closeButton: {
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: '20px',
    insetInlineEnd: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: cssVar.borderRadius,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  container: {
    position: 'fixed',
    zIndex: 9999,
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
  },
  content: {
    position: 'relative',
    overflow: 'hidden',
    maxWidth: '480px',
    padding: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillQuaternary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  desc: { lineHeight: 1.6, color: cssVar.colorTextSecondary },
  title: { fontSize: '16px', fontWeight: 'bold', color: cssVar.colorWarningText },
  titleIcon: { flexShrink: 0, color: cssVar.colorWarning },
  warning: {
    padding: '12px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorWarningText,
    backgroundColor: `var(--warning-yellow-bg, ${cssVar.colorWarningBg})`,
    backgroundImage: 'none',
  },
});

const ServerVersionOutdatedAlert = () => {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const [dismissed, setDismissed] = useState(false);
  const isServerVersionOutdated = useGlobalStore((s) => s.isServerVersionOutdated);
  const isOfficialServer = useElectronStore(electronSyncSelectors.isOfficialServer);

  const cssVariables = useMemo<Record<string, string>>(
    () => ({
      '--content-yellow-border': theme.yellowBorder,
      '--warning-yellow-bg': theme.yellowBg,
    }),
    [theme.yellowBorder, theme.yellowBg],
  );

  if (isOfficialServer || !isServerVersionOutdated || dismissed) return null;

  return (
    <div {...stylex.props(styles.container)}>
      <div className={stylex.props(styles.content).className} style={cssVariables}>
        <div {...stylex.props(styles.closeButton)} onClick={() => setDismissed(true)}>
          <Icon icon={X} />
        </div>

        <Flexbox gap={16}>
          <Flexbox horizontal align="center" gap={8}>
            <Icon className={stylex.props(styles.titleIcon).className} icon={TriangleAlert} />
            <div {...stylex.props(styles.title)}>{t('serverVersionOutdated.title')}</div>
          </Flexbox>

          <div {...stylex.props(styles.desc)}>
            {t('serverVersionOutdated.desc', { version: CURRENT_VERSION })}
          </div>

          <div {...stylex.props(styles.warning)}>{t('serverVersionOutdated.warning')}</div>

          <Flexbox horizontal gap={8} justify="flex-end" style={{ marginTop: 8 }}>
            <a href={MANUAL_UPGRADE_URL} rel="noreferrer" target="_blank">
              <Button size="small" type="primary">
                {t('serverVersionOutdated.upgrade')}
              </Button>
            </a>
            <Button size="small" onClick={() => setDismissed(true)}>
              {t('serverVersionOutdated.dismiss')}
            </Button>
          </Flexbox>
        </Flexbox>
      </div>
    </div>
  );
};

export default ServerVersionOutdatedAlert;
