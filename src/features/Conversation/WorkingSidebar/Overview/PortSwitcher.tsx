import { Icon, Input, Tooltip } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CopyIcon, GlobeIcon, LoaderCircleIcon, PlugZapIcon, XIcon } from 'lucide-react';
import { memo, type ReactElement, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortTunnels } from './usePortTunnels';

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    cursor: pointer;

    display: flex;
    flex-shrink: 0;
    align-items: center;

    padding: 2px;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  container: css`
    display: flex;
    flex-direction: column;
    width: 260px;
    padding: 4px;
  `,
  empty: css`
    padding-block: 10px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  retry: css`
    cursor: pointer;

    padding: 0;
    border: none;

    font-size: 12px;
    color: ${cssVar.colorInfo};

    background: transparent;
  `,
  state: css`
    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  host: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  hint: css`
    padding-block: 6px 2px;
    padding-inline: 8px;

    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextQuaternary};
  `,
  item: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  port: css`
    flex-shrink: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  section: css`
    padding-block: 6px 4px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface PortSwitcherProps {
  children: ReactElement;
  deviceId: string;
}

/**
 * Exposes a port on the working device as a link. Opening is a two-step by
 * design: the stored link is clean, and the token that opens it is minted per
 * click, so nothing long-lived sits in the UI or the clipboard.
 */
const PortSwitcher = memo<PortSwitcherProps>(({ children, deviceId }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const {
    busySlug,
    copyLink,
    creating,
    error,
    exposePort,
    isLoading,
    openLink,
    port,
    refresh,
    revokeLink,
    setPort,
    tunnels,
  } = usePortTunnels(deviceId, open, close);

  return (
    <DropdownMenuRoot open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>{children}</DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement={'bottomLeft'} sideOffset={8}>
          <DropdownMenuPopup>
            <div className={styles.container}>
              <div className={styles.section}>{t('workingPanel.overview.ports.heading')}</div>

              {isLoading ? (
                <div className={styles.state}>
                  <Icon spin icon={LoaderCircleIcon} size={13} />
                  {t('workingPanel.overview.ports.loading')}
                </div>
              ) : error ? (
                // "We couldn't ask" must not read as "nothing is open".
                <div className={styles.state}>
                  {t('workingPanel.overview.ports.loadFailed')}
                  <button className={styles.retry} type={'button'} onClick={() => void refresh()}>
                    {tCommon('retry')}
                  </button>
                </div>
              ) : tunnels.length === 0 ? (
                <div className={styles.empty}>{t('workingPanel.overview.ports.empty')}</div>
              ) : (
                tunnels.map((link) => (
                  <DropdownMenuItem
                    className={styles.item}
                    key={link.slug}
                    onClick={(event) => {
                      event.preventDefault();
                      void openLink(link);
                    }}
                  >
                    <Icon
                      icon={busySlug === link.slug ? LoaderCircleIcon : GlobeIcon}
                      size={14}
                      spin={busySlug === link.slug}
                    />
                    <span className={styles.port}>{link.port}</span>
                    <span className={styles.host}>{link.hostname}</span>
                    <Tooltip title={t('workingPanel.overview.ports.copy')}>
                      <button
                        aria-label={t('workingPanel.overview.ports.copy')}
                        className={styles.action}
                        type={'button'}
                        // Enter/Space must act on this button, not fall through
                        // to the menu item and open the tunnel instead.
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void copyLink(link);
                        }}
                      >
                        <Icon icon={CopyIcon} size={13} />
                      </button>
                    </Tooltip>
                    <Tooltip title={t('workingPanel.overview.ports.revoke')}>
                      <button
                        aria-label={t('workingPanel.overview.ports.revoke')}
                        className={styles.action}
                        type={'button'}
                        onKeyDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void revokeLink(link);
                        }}
                      >
                        <Icon icon={XIcon} size={13} />
                      </button>
                    </Tooltip>
                  </DropdownMenuItem>
                ))
              )}

              <div className={styles.section}>{t('workingPanel.overview.ports.expose')}</div>
              <Input
                disabled={creating}
                placeholder={t('workingPanel.overview.ports.addPlaceholder')}
                size={'small'}
                value={port}
                prefix={
                  <Icon
                    icon={creating ? LoaderCircleIcon : PlugZapIcon}
                    size={14}
                    spin={creating}
                  />
                }
                onChange={(e) => setPort(e.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') void exposePort();
                }}
              />
              <div className={styles.hint}>{t('workingPanel.overview.ports.hint')}</div>
            </div>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

PortSwitcher.displayName = 'PortSwitcher';

export default PortSwitcher;
