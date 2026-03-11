import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckIcon, RouterIcon, TerminalIcon } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';

// Define styles using antd-style (moved from MCPManifestForm)
const styles = createStaticStyles(({ css }) => ({
  active: css`
    border-color: ${cssVar.colorPrimary};

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  cardDescription: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextDescription};
  `,
  cardTitle: css`
    font-weight: bold;
  `,
  checkIcon: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-end: 12px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 50%;

    color: ${cssVar.colorBgContainer};

    background-color: ${cssVar.colorPrimary};
  `,
  container: css`
    cursor: pointer;

    position: relative;

    width: 100%;
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};

    background-color: ${cssVar.colorBgContainer};

    transition:
      border-color 0.3s ${cssVar.motionEaseInOut},
      box-shadow 0.3s ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorPrimaryHover};
    }
  `,
  disabled: css`
    cursor: not-allowed;
    border-color: ${cssVar.colorBorder};
    opacity: 0.5;
    background-color: ${cssVar.colorBgContainerDisabled};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  featureIcon: css`
    color: ${cssVar.colorTextSecondary};
  `,
  featureItem: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  featureText: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
}));

// Helper component for feature list items (moved from MCPManifestForm)
const FeatureItem = memo(({ children }: { children: React.ReactNode }) => {
  return (
    <div className={styles.featureItem}>
      <Center className={styles.featureIcon}>
        <CheckIcon color={cssVar.colorSuccess} size={16} />
      </Center>
      <div className={styles.featureText}>{children}</div>
    </div>
  );
});

interface MCPTypeSelectProps {
  onChange?: (value: string) => void;
  value?: string;
}

const MCPTypeSelect = ({ value, onChange }: MCPTypeSelectProps) => {
  const { t } = useTranslation('plugin');

  const handleSelect = (type: string) => {
    onChange?.(type);
  };

  const data = [
    {
      description: t('dev.mcp.type.httpShortDesc'),
      features: [t('dev.mcp.type.httpFeature1'), t('dev.mcp.type.httpFeature2')],
      icon: RouterIcon,
      label: 'Streamable HTTP',
      value: 'http',
    },
    {
      description: t('dev.mcp.type.stdioShortDesc'),
      features: [t('dev.mcp.type.stdioFeature1'), t('dev.mcp.type.stdioFeature2')],
      icon: TerminalIcon,
      label: 'STDIO',
      value: 'stdio',
    },
  ];

  return (
    <Flexbox horizontal gap={16} width={'100%'}>
      {data.map(({ label, description, features, value: itemValue, icon }) => {
        const isActive = value === itemValue;
        const disabled = itemValue === 'stdio' && !isDesktop;
        return (
          <Flexbox
            className={cx(styles.container, isActive && styles.active, disabled && styles.disabled)}
            gap={12}
            key={itemValue}
            style={{ flex: 1 }} // Make cards take equal width
            onClick={disabled ? undefined : () => handleSelect(itemValue)}
          >
            <Center className={styles.checkIcon} style={{ opacity: isActive ? 1 : 0 }}>
              <CheckIcon size={14} />
            </Center>

            <Flexbox horizontal align={'flex-start'} gap={12}>
              <Center height={22}>
                <Icon icon={icon} style={{ fontSize: 16 }} />
              </Center>
              <Flexbox>
                <div className={styles.cardTitle}>{label}</div>
                <div className={styles.cardDescription}>{description}</div>
              </Flexbox>
            </Flexbox>
            <Flexbox gap={8}>
              {features.map((feature) => (
                <FeatureItem key={feature}>{feature}</FeatureItem>
              ))}
            </Flexbox>
            {disabled && (
              <Text style={{ fontSize: 12, marginTop: 8 }} type="warning">
                {t('dev.mcp.type.stdioNotAvailable')}
              </Text>
            )}
          </Flexbox>
        );
      })}
      {/* Streamable HTTP Card */}
    </Flexbox>
  );
};

export default MCPTypeSelect;
