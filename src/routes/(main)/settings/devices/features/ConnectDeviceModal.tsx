'use client';

import { DOWNLOAD_URL } from '@lobechat/const';
import { Button, CopyButton, Flexbox, Input, Modal, Tabs, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LaptopIcon, LinkIcon, MonitorDownIcon, RefreshCwIcon, TerminalIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  codeBlock: css`
    position: relative;

    overflow: hidden;

    padding: 12px 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius}px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    line-height: 1.7;
    color: ${cssVar.colorText};
    white-space: nowrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  codeBlockInline: css`
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12.5px;

    background: ${cssVar.colorFillQuaternary};
    white-space: nowrap;

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  copyBtn: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;
  `,
  dot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
  pairingBox: css`
    display: flex;
    align-items: center;
    justify-content: center;

    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius}px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 28px;
    letter-spacing: 8px;
    color: ${cssVar.colorText};
    text-align: center;

    background: ${cssVar.colorFillTertiary};
  `,
  step: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM}px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  subtitle: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  tabContent: css`
    padding-block-start: 20px;
  `,
}));

interface ConnectDeviceModalProps {
  initialCode?: string;
  initialTab?: string;
  onClose: () => void;
  onPaired?: (code: string) => void;
  open: boolean;
}

const terminalCommands: {
  code: string;
  description: string;
  key: string;
  title: string;
}[] = [
  {
    code: 'npm install -g @lobehub/cli',
    description: 'installDesc',
    key: 'install',
    title: 'installTitle',
  },
  {
    code: 'lh login',
    description: 'loginDesc',
    key: 'login',
    title: 'loginTitle',
  },
  {
    code: 'lh connect --daemon',
    description: 'connectDesc',
    key: 'connect',
    title: 'connectTitle',
  },
];

const generatePairingCode = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

const ConnectDeviceModal = memo<ConnectDeviceModalProps>(({
  onClose,
  open,
  initialCode,
  initialTab,
  onPaired,
}) => {
  const { t } = useTranslation('setting');
  const [pairingCode, setPairingCode] = useState('');
  const [inputCode, setInputCode] = useState('');

  useEffect(() => {
    if (open) {
      setInputCode(initialCode ?? '');
      setPairingCode('');
    }
  }, [open, initialCode]);

  const handleConfirmPair = () => {
    if (!inputCode.trim()) return;
    onPaired?.(inputCode.trim());
  };

  const tabItems = [
    {
      children: (
        <Flexbox className={styles.tabContent} gap={20}>
          <Flexbox gap={12}>
            <Text style={{ fontSize: 14, fontWeight: 500 }}>
              {t('devices.connectWizard.desktop.step1')}
            </Text>
            <Text className={styles.subtitle}>{t('devices.connectWizard.desktop.step1Desc')}</Text>
            <a
              href={DOWNLOAD_URL.default}
              rel="noreferrer"
              style={{ display: 'inline-block', width: 'fit-content' }}
              target="_blank"
            >
              <Flexbox
                horizontal
                align={'center'}
                className={styles.codeBlockInline}
                gap={6}
              >
                <MonitorDownIcon size={14} />
                <span>{t('devices.connectWizard.desktop.downloadLink')}</span>
              </Flexbox>
            </a>
          </Flexbox>

          <Flexbox gap={12}>
            <Text style={{ fontSize: 14, fontWeight: 500 }}>
              {t('devices.connectWizard.desktop.step2')}
            </Text>
            <Text className={styles.subtitle}>{t('devices.connectWizard.desktop.step2Desc')}</Text>
          </Flexbox>

          <Flexbox gap={12}>
            <Text style={{ fontSize: 14, fontWeight: 500 }}>
              {t('devices.connectWizard.desktop.step3')}
            </Text>
            <Text className={styles.subtitle}>{t('devices.connectWizard.desktop.step3Desc')}</Text>
            <Flexbox horizontal align={'center'} gap={8}>
              <span className={styles.dot} style={{ background: cssVar.colorSuccess }} />
              <Text style={{ fontSize: 13 }} type={'secondary'}>
                {t('devices.connectWizard.desktop.step3Hint')}
              </Text>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      ),
      icon: <MonitorDownIcon size={16} />,
      key: 'desktop',
      label: t('devices.connectWizard.method.desktop'),
    },
    {
      children: (
        <Flexbox className={styles.tabContent} gap={20}>
          <Text className={styles.subtitle}>{t('devices.connectWizard.cli.intro')}</Text>

          {terminalCommands.map((cmd, idx) => (
            <Flexbox gap={10} key={cmd.key}>
              <Flexbox horizontal align={'center'} gap={8}>
                <span className={styles.step}>{idx + 1}</span>
                <Text style={{ fontSize: 14, fontWeight: 500 }}>
                  {t(`devices.connectWizard.cli.${cmd.title}`)}
                </Text>
              </Flexbox>
              <Text className={styles.subtitle} style={{ paddingInlineStart: 28 }}>
                {t(`devices.connectWizard.cli.${cmd.description}`)}
              </Text>
              <div className={styles.codeBlock} style={{ marginInlineStart: 28 }}>
                <code style={{ paddingInlineEnd: 36, display: 'block' }}>{cmd.code}</code>
                <span className={styles.copyBtn}>
                  <CopyButton content={cmd.code} size={'small'} />
                </span>
              </div>
            </Flexbox>
          ))}

          {/* Privacy notice */}
          <Text className={styles.subtitle} style={{ fontSize: 12 }}>
            {t('devices.connectWizard.cli.privacyNote')}
          </Text>
        </Flexbox>
      ),
      icon: <TerminalIcon size={16} />,
      key: 'cli',
      label: t('devices.connectWizard.method.cli'),
    },
    {
      children: (
        <Flexbox className={styles.tabContent} gap={20}>
          {/* Step 1: Show pairing code */}
          <Flexbox gap={10}>
            <Flexbox horizontal align={'center'} gap={8}>
              <span className={styles.step}>1</span>
              <Text style={{ fontSize: 14, fontWeight: 500 }}>
                {t('devices.connectWizard.browser.step1')}
              </Text>
            </Flexbox>
            <Text className={styles.subtitle} style={{ paddingInlineStart: 28 }}>
              {t('devices.connectWizard.browser.step1Desc')}
            </Text>
            <div className={styles.pairingBox} style={{ marginInlineStart: 28 }}>
              {pairingCode || '●●●●●●'}
            </div>
            <div style={{ paddingInlineStart: 28 }}>
              <Button
                icon={<RefreshCwIcon size={14} />}
                size={'small'}
                onClick={() => setPairingCode(generatePairingCode())}
              >
                {t('devices.connectWizard.browser.refresh')}
              </Button>
            </div>
          </Flexbox>

          {/* Step 2: Enter pairing code from another device */}
          <Flexbox gap={10}>
            <Flexbox horizontal align={'center'} gap={8}>
              <span className={styles.step}>2</span>
              <Text style={{ fontSize: 14, fontWeight: 500 }}>
                {t('devices.connectWizard.browser.step2')}
              </Text>
            </Flexbox>
            <Text className={styles.subtitle} style={{ paddingInlineStart: 28 }}>
              {t('devices.connectWizard.browser.step2Desc')}
            </Text>
            <Flexbox horizontal gap={8} style={{ paddingInlineStart: 28 }}>
              <Input
                prefix={<LaptopIcon size={14} />}
                placeholder={t('devices.connectWizard.browser.inputPlaceholder')}
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                onPressEnter={handleConfirmPair}
                style={{ flex: 1 }}
              />
              <Button
                icon={<LinkIcon size={14} />}
                type={'primary'}
                onClick={handleConfirmPair}
              >
                {t('devices.connectWizard.browser.confirm')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      ),
      icon: <LaptopIcon size={16} />,
      key: 'browser',
      label: t('devices.connectWizard.method.browser'),
    },
  ];

  return (
    <Modal
      footer={null}
      onClose={onClose}
      open={open}
      title={t('devices.connectWizard.title')}
      width={540}
    >
      <Tabs defaultActiveKey={initialTab ?? 'desktop'} items={tabItems} />
      {/* Subtitle below tabs to explain what the overall modal is about */}
      <Flexbox gap={8} style={{ marginBlockStart: 4 }}>
        <Text className={styles.subtitle}>{t('devices.connectWizard.subtitle')}</Text>
      </Flexbox>
    </Modal>
  );
});

ConnectDeviceModal.displayName = 'ConnectDeviceModal';

export default ConnectDeviceModal;
