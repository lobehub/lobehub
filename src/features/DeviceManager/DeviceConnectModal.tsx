'use client';

import { DOWNLOAD_URL } from '@lobechat/const';
import type { DeviceScope, DeviceVisibility } from '@lobechat/types';
import { CopyButton, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { DownloadIcon, MonitorDownIcon, ShieldCheckIcon, TerminalIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import ImperativeModal from '@/components/ImperativeModal';

const styles = createStaticStyles(({ css }) => ({
  codeBlock: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  command: css`
    overflow: hidden;
    flex: 1;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  footer: css`
    margin-block-start: 4px;
    padding-block-start: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  index: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;

    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  line: css`
    flex: 1;
    width: 1px;
    margin-block-start: 4px;
    background: ${cssVar.colorBorderSecondary};
  `,
}));

interface StepProps {
  children?: React.ReactNode;
  desc?: string;
  index: number;
  last?: boolean;
  title: string;
}

const Step = memo<StepProps>(({ index, title, desc, children, last }) => (
  <Flexbox horizontal gap={16}>
    <Flexbox align={'center'}>
      <span className={styles.index}>{index}</span>
      {!last && <span className={styles.line} />}
    </Flexbox>
    <Flexbox flex={1} gap={4} style={{ paddingBlockEnd: last ? 0 : 24 }}>
      <Text weight={500}>{title}</Text>
      {desc && (
        <Text color={cssVar.colorTextTertiary} lineHeight={1.6}>
          {desc}
        </Text>
      )}
      {children && <div style={{ marginBlockStart: 12 }}>{children}</div>}
    </Flexbox>
  </Flexbox>
));

const CommandLine = memo<{ command: string }>(({ command }) => (
  <div className={styles.codeBlock}>
    <code className={styles.command}>{command}</code>
    <CopyButton content={command} size={'small'} />
  </div>
));

interface DeviceConnectModalProps {
  initialTab?: 'cli' | 'desktop';
  onClose: () => void;
  open: boolean;
  scope: DeviceScope;
  /**
   * Workspace scope only: which pool the wizard enrolls into. The CLI enrolls
   * private (enroller-only) by default, so 'public' appends `--public` to the
   * connect command to register into the shared pool (the settings page passes
   * the active tab here).
   */
  visibility?: DeviceVisibility;
}

/**
 * Device enrollment wizard, shared by the personal and workspace device pages.
 * - Personal: Desktop (auto-connect) + CLI tabs.
 * - Workspace: CLI-only (shared machines are headless), and the connect step
 *   carries the `--workspace <id>` flag that routes the device to the workspace
 *   principal (plus `--public` when enrolling from the Workspace tab — the CLI
 *   defaults to a private enrollment). Member+ on the server.
 */
const DeviceConnectModal = memo<DeviceConnectModalProps>(
  ({ onClose, open, initialTab, scope, visibility }) => {
    const { t } = useTranslation('setting');
    const workspaceId = useActiveWorkspaceId();
    const isWorkspace = scope === 'workspace';

    const [active, setActive] = useState<'cli' | 'desktop'>(initialTab ?? 'desktop');
    useEffect(() => {
      if (open) setActive(isWorkspace ? 'cli' : (initialTab ?? 'desktop'));
    }, [open, initialTab, isWorkspace]);

    const connectCommand = isWorkspace
      ? `lh connect --workspace ${workspaceId ?? '<workspace-id>'}${
          visibility === 'public' ? ' --public' : ''
        } --daemon`
      : 'lh connect --daemon';

    const cliSteps = (
      <Flexbox>
        <Step index={1} title={t('devices.connectWizard.cli.installTitle')}>
          <CommandLine command={'npm install -g @lobehub/cli'} />
        </Step>
        <Step index={2} title={t('devices.connectWizard.cli.loginTitle')}>
          <CommandLine command={'lh login'} />
        </Step>
        <Step
          last
          index={3}
          title={t('devices.connectWizard.cli.connectTitle')}
          desc={
            isWorkspace
              ? t('workspaceSetting.devices.enrollDesc')
              : t('devices.connectWizard.cli.connectDesc')
          }
        >
          <CommandLine command={connectCommand} />
        </Step>
      </Flexbox>
    );

    return (
      <ImperativeModal
        footer={null}
        open={open}
        width={560}
        title={
          isWorkspace
            ? t(
                visibility === 'private'
                  ? 'workspaceSetting.devices.connectTitlePrivate'
                  : 'workspaceSetting.devices.connectTitlePublic',
              )
            : t('devices.connectWizard.title')
        }
        onCancel={onClose}
      >
        <Flexbox gap={20}>
          {!isWorkspace && (
            <Text color={cssVar.colorTextTertiary}>{t('devices.connectWizard.subtitle')}</Text>
          )}

          {isWorkspace ? null : (
            <Tabs
              activeKey={active}
              items={[
                {
                  icon: <Icon icon={MonitorDownIcon} />,
                  key: 'desktop',
                  label: t('devices.connectWizard.method.desktop'),
                },
                {
                  icon: <Icon icon={TerminalIcon} />,
                  key: 'cli',
                  label: t('devices.connectWizard.method.cli'),
                },
              ]}
              styles={{
                list: { display: 'flex', width: '100%' },
                tab: { flex: 1 },
              }}
              onChange={(key) => setActive(key as 'cli' | 'desktop')}
            />
          )}

          {!isWorkspace && active === 'desktop' ? (
            <Flexbox>
              <Step
                desc={t('devices.connectWizard.desktop.step1Desc')}
                index={1}
                title={t('devices.connectWizard.desktop.step1')}
              >
                <a href={DOWNLOAD_URL.default} rel="noreferrer" target="_blank">
                  <Button icon={<Icon icon={DownloadIcon} />} type={'primary'}>
                    {t('devices.connectWizard.desktop.downloadLink')}
                  </Button>
                </a>
              </Step>
              <Step
                desc={t('devices.connectWizard.desktop.step2Desc')}
                index={2}
                title={t('devices.connectWizard.desktop.step2')}
              />
              <Step
                last
                desc={t('devices.connectWizard.desktop.step3Desc')}
                index={3}
                title={t('devices.connectWizard.desktop.step3')}
              />
            </Flexbox>
          ) : (
            cliSteps
          )}

          <Flexbox horizontal align={'center'} className={styles.footer} gap={8}>
            <Icon icon={ShieldCheckIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {t('devices.connectWizard.footer')}
            </Text>
          </Flexbox>
        </Flexbox>
      </ImperativeModal>
    );
  },
);

DeviceConnectModal.displayName = 'DeviceConnectModal';

export default DeviceConnectModal;
