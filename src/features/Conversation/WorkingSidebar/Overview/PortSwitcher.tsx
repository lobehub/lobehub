import type { DeviceListeningPort } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  CopyIcon,
  GlobeIcon,
  LoaderCircleIcon,
  RadarIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react';
import {
  type KeyboardEvent,
  memo,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceTunnelLink } from '@/store/device';

import { OverviewRow, PickerGlyph } from './OverviewRow';
import { usePortTunnels } from './usePortTunnels';

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    cursor: pointer;

    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    padding: 0;
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
  actions: css`
    display: flex;
    flex-shrink: 0;
    gap: 2px;
    align-items: center;

    /* Pull the last glyph flush with the text trailing of the other rows. */
    margin-inline-end: -4px;
  `,
  available: css`
    font-size: 12px;
    color: ${cssVar.colorPrimary};
  `,
  command: css`
    overflow: hidden;
    flex-shrink: 1;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
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
  expose: css`
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorPrimary};
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
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 6px 4px;
    padding-inline: 8px 4px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  item: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  othersList: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;

    /* A dev machine listens on dozens of ports; the list scrolls inside the
       menu instead of pushing it past the viewport. */
    max-height: 200px;
  `,
  port: css`
    flex-shrink: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  retry: css`
    cursor: pointer;

    padding: 0;
    border: none;

    font-size: 12px;
    color: ${cssVar.colorInfo};

    background: transparent;
  `,
  spacer: css`
    flex: 1;
    min-width: 0;
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
  toggle: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface PortSwitcherProps {
  /** Whether the working panel is showing; detection only runs while it is. */
  active: boolean;
  deviceId: string;
  /** Project directory, so the device can say which ports belong to it. */
  workingDirectory?: string;
}

/**
 * The ports of the working device, as one list: ports that already have a link
 * sit on top (open, copy, stop), the project's running servers follow with one
 * click to expose, and everything else listening on the machine is folded away.
 *
 * Opening is two-step by design: the stored link is clean, and the token that
 * opens it is minted per click, so nothing long-lived sits in the UI or the
 * clipboard.
 */
const PortSwitcher = memo<PortSwitcherProps>(({ active, deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const {
    busySlug,
    copyLink,
    creatingPort,
    detected,
    detectionAvailable,
    detectionLoading,
    error,
    exposePort,
    isLoading,
    openLink,
    otherPorts,
    refresh,
    refreshDetected,
    revokeLink,
    tunnels,
  } = usePortTunnels({ active, cwd: workingDirectory, deviceId, onOpened: close, open });

  /**
   * Port, then process. No "this project" tag: the main list only holds the
   * project's own ports, and the rest are already folded under "Other ports".
   */
  const renderLabel = (port: number, info?: DeviceListeningPort) => (
    <>
      <span className={styles.port}>{port}</span>
      {info?.command && (
        <span className={styles.command} title={info.cwd}>
          {info.command}
        </span>
      )}
      <span className={styles.spacer} />
    </>
  );

  /**
   * A small button inside the menu: it acts on its own and never opens the
   * tunnel. Kept out of the tab order because the menu focuses its first
   * tabbable element on open, which would land here and pop its tooltip on
   * every open; the menu items it sits on are reachable with the arrow keys.
   */
  const ownPress = (onPress: () => void) => ({
    // Enter/Space must act on this button, not fall through to the menu item.
    onKeyDown: (event: KeyboardEvent) => event.stopPropagation(),
    tabIndex: -1,
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onPress();
    },
  });

  const renderLink = (link: DeviceTunnelLink) => (
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
      {/* The link itself, so the row says where the port is reachable; copy sits
          right beside it. A link starts with its port (`5199--slug.lobe.sh`),
          so the port is drawn as the link's own prefix instead of repeated
          before it — that leaves room for the whole domain. */}
      <span className={styles.host} title={link.hostname}>
        {link.hostname.startsWith(`${link.port}--`) ? (
          <>
            <span className={styles.port}>{link.port}</span>
            {link.hostname.slice(String(link.port).length)}
          </>
        ) : (
          link.hostname
        )}
      </span>
      <span className={styles.actions}>
        <Tooltip title={t('workingPanel.overview.ports.copy')}>
          <button
            aria-label={t('workingPanel.overview.ports.copy')}
            className={styles.action}
            type={'button'}
            {...ownPress(() => void copyLink(link))}
          >
            <Icon icon={CopyIcon} size={13} />
          </button>
        </Tooltip>
        <Tooltip title={t('workingPanel.overview.ports.revoke')}>
          <button
            aria-label={t('workingPanel.overview.ports.revoke')}
            className={styles.action}
            type={'button'}
            {...ownPress(() => void revokeLink(link))}
          >
            <Icon icon={XIcon} size={13} />
          </button>
        </Tooltip>
      </span>
    </DropdownMenuItem>
  );

  const renderDetected = (item: DeviceListeningPort) => (
    <DropdownMenuItem
      className={styles.item}
      key={item.port}
      onClick={(event) => {
        event.preventDefault();
        void exposePort(item.port);
      }}
    >
      <Icon
        icon={creatingPort === item.port ? LoaderCircleIcon : RadarIcon}
        size={14}
        spin={creatingPort === item.port}
      />
      {renderLabel(item.port, item)}
      <span className={styles.expose}>{t('workingPanel.overview.ports.detected.expose')}</span>
    </DropdownMenuItem>
  );

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className={styles.state}>
        <Icon spin icon={LoaderCircleIcon} size={13} />
        {t('workingPanel.overview.ports.loading')}
      </div>
    );
  } else if (error) {
    // "We couldn't ask" must not read as "nothing is open".
    body = (
      <div className={styles.state}>
        {t('workingPanel.overview.ports.loadFailed')}
        <button className={styles.retry} type={'button'} onClick={() => void refresh()}>
          {tCommon('retry')}
        </button>
      </div>
    );
  } else if (tunnels.length === 0 && detected.length === 0) {
    body = (
      <div className={styles.empty}>
        {detectionAvailable
          ? t('workingPanel.overview.ports.detected.none')
          : t('workingPanel.overview.ports.unavailable')}
      </div>
    );
  } else {
    body = (
      <>
        {tunnels.map(renderLink)}
        {detected.map(renderDetected)}
      </>
    );
  }

  return (
    <DropdownMenuRoot open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>
        <OverviewRow
          interactive
          icon={GlobeIcon}
          value={t('workingPanel.overview.ports.title')}
          trailing={
            <>
              {detected.length > 0 && (
                // A running dev server the user hasn't exposed yet — say so
                // without making them open the menu.
                <span className={styles.available}>
                  {t('workingPanel.overview.ports.detected.available', { count: detected.length })}
                </span>
              )}
              <PickerGlyph />
            </>
          }
        />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement={'bottomLeft'} sideOffset={8}>
          <DropdownMenuPopup>
            <div className={styles.container}>
              <div className={styles.header}>
                {t('workingPanel.overview.ports.title')}
                {/* Kept even when detection is unavailable: a device that just came
                    back online is otherwise stuck on the stale answer. */}
                <Tooltip title={t('workingPanel.overview.ports.detected.refresh')}>
                  <button
                    aria-label={t('workingPanel.overview.ports.detected.refresh')}
                    className={styles.action}
                    type={'button'}
                    {...ownPress(() => void refreshDetected())}
                  >
                    <Icon icon={RefreshCwIcon} size={12} spin={detectionLoading} />
                  </button>
                </Tooltip>
              </div>

              {body}

              {otherPorts.length > 0 && (
                <>
                  <DropdownMenuItem
                    className={styles.toggle}
                    closeOnClick={false}
                    onClick={() => setShowOthers((value) => !value)}
                  >
                    {showOthers
                      ? t('workingPanel.overview.ports.detected.hideOthers')
                      : t('workingPanel.overview.ports.detected.others', {
                          count: otherPorts.length,
                        })}
                  </DropdownMenuItem>
                  {showOthers && (
                    <div className={styles.othersList}>{otherPorts.map(renderDetected)}</div>
                  )}
                </>
              )}
            </div>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

PortSwitcher.displayName = 'PortSwitcher';

export default PortSwitcher;
