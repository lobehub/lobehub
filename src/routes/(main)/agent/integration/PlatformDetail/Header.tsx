'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Switch, Typography } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type IntegrationProvider } from '../const';

const { Title, Text } = Typography;

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    display: flex;
    justify-content: center;

    width: 100%;
    padding-block: 16px;
    padding-inline: 0;

    background: ${cssVar.colorBgContainer};
  `,
  headerContent: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    max-width: 800px;
    padding-block: 0;
    padding-inline: 24px;
  `,
  headerIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: 10px;

    color: ${cssVar.colorText};

    fill: white;
  `,
}));

interface HeaderProps {
  currentConfig?: {
    enabled: boolean;
  };
  onToggleEnable: (enabled: boolean) => void;
  provider: IntegrationProvider;
}

const Header = memo<HeaderProps>(({ provider, currentConfig, onToggleEnable }) => {
  const { t } = useTranslation('agent');
  const ProviderIcon = provider.icon;

  return (
    <header className={styles.header}>
      <div className={styles.headerContent}>
        <Flexbox horizontal align="center" gap={12}>
          <div className={styles.headerIcon} style={{ background: provider.color }}>
            <Icon fill={'white'} icon={ProviderIcon} size={'large'} />
          </div>
          <div>
            <Flexbox align="center">
              <Title level={5} style={{ margin: 0 }}>
                {provider.name}
              </Title>
              <Text style={{ fontSize: 12 }} type="secondary">
                {provider.description}
              </Text>
            </Flexbox>
          </div>
        </Flexbox>

        {currentConfig && (
          <Flexbox horizontal align="center" gap={12}>
            <Text strong>
              {currentConfig.enabled ? t('integration.enabled') : t('integration.disabled')}
            </Text>
            <Switch checked={currentConfig.enabled} onChange={onToggleEnable} />
          </Flexbox>
        )}
      </div>
    </header>
  );
});

export default Header;
