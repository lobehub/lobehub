'use client';

import { DOWNLOAD_URL } from '@lobechat/const';
import { Button, CopyButton, Flexbox, Icon, Modal, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { DownloadIcon, MonitorDownIcon, ShieldCheckIcon, TerminalIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  codeBlock: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  command: css`
    overflow: hidden;
    flex: 1;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  footer: css`
    margin-block-start: 4px;
    padding-block-start: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  index: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;

    font-size: 12px;
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
  stepDesc: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  subtitle: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface ConnectDeviceModalProps {
  initialTab?: 'cli' | 'desktop';
  onClose: () => void;
  open: boolean;
}

interface StepProps {
  children?: React.ReactNode;
  desc: string;
  index: number;
  last?: boolean;
  title: string;
}

const Step = memo<StepProps>(({ index, title, desc, children, last }) => (
  <Flexbox horizontal gap={14}>
    <Flexbox align={'center'}>
      <span className={styles.index}>{index}</span>
      {!last && <span className={styles.line} />}
    </Flexbox>
    <Flexbox flex={1} gap={4} style={{ paddingBlockEnd: last ? 0 : 24 }}>
      <Text style={{ fontSize: 14, fontWeight: 500 }}>{title}</Text>
      <Text className={styles.stepDesc}>{desc}</Text>
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

const cliCommands = {
  connect: 'lh connect --daemon',
  install: 'npm install -g @lobehub/cli',
  login: 'lh login',
};

const ConnectDeviceModal = memo<ConnectDeviceModalProps>(({ onClose, open, initialTab }) => {
  const { t } = useTranslation('setting');
  const [active, setActive] = useState<'cli' | 'desktop'>(initialTab ?? 'desktop');

  useEffect(() => {
    if (open) setActive(initialTab ?? 'desktop');
  }, [open, initialTab]);

  return (
    <Modal
      footer={null}
      open={open}
      title={t('devices.connectWizard.title')}
      width={560}
      onCancel={onClose}
    >
      <Flexbox gap={20}>
        <Text className={styles.subtitle}>{t('devices.connectWizard.subtitle')}</Text>

        <Segmented
          block
          value={active}
          options={[
            {
              icon: <Icon icon={MonitorDownIcon} />,
              label: t('devices.connectWizard.method.desktop'),
              value: 'desktop',
            },
            {
              icon: <Icon icon={TerminalIcon} />,
              label: t('devices.connectWizard.method.cli'),
              value: 'cli',
            },
          ]}
          onChange={(value) => setActive(value as 'cli' | 'desktop')}
        />

        {active === 'desktop' ? (
          <Flexbox>
            <Step
              desc={t('devices.connectWizard.desktop.step1Desc')}
              index={1}
              title={t('devices.connectWizard.desktop.step1')}
            >
              <a href={DOWNLOAD_URL.default} rel="noreferrer" target="_blank">
                <Button icon={<Icon icon={DownloadIcon} />} size={'small'} type={'primary'}>
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
          <Flexbox>
            <Step
              desc={t('devices.connectWizard.cli.installDesc')}
              index={1}
              title={t('devices.connectWizard.cli.installTitle')}
            >
              <CommandLine command={cliCommands.install} />
            </Step>
            <Step
              desc={t('devices.connectWizard.cli.loginDesc')}
              index={2}
              title={t('devices.connectWizard.cli.loginTitle')}
            >
              <CommandLine command={cliCommands.login} />
            </Step>
            <Step
              last
              desc={t('devices.connectWizard.cli.connectDesc')}
              index={3}
              title={t('devices.connectWizard.cli.connectTitle')}
            >
              <CommandLine command={cliCommands.connect} />
            </Step>
          </Flexbox>
        )}

        <Flexbox horizontal align={'center'} className={styles.footer} gap={8}>
          <Icon icon={ShieldCheckIcon} size={14} style={{ color: cssVar.colorPrimary }} />
          {t('devices.connectWizard.footer')}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
});

ConnectDeviceModal.displayName = 'ConnectDeviceModal';

export default ConnectDeviceModal;
