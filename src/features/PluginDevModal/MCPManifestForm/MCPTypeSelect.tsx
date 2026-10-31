import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, RouterIcon, TerminalIcon } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';

const styles = stylex.create({
  active: { borderColor: { 'default': cssVar.colorPrimary, ':hover': cssVar.colorPrimary } },
  cardDescription: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextDescription },
  cardTitle: { fontWeight: 'bold' },
  checkIcon: {
    position: 'absolute',
    insetBlockStart: '12px',
    insetInlineEnd: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorPrimary,
  },
  container: {
    cursor: 'pointer',
    position: 'relative',
    width: '100%',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorPrimaryHover },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    transition: `border-color 0.3s ${cssVar.motionEaseInOut},
      box-shadow 0.3s ${cssVar.motionEaseInOut}`,
  },
  disabled: {
    cursor: 'not-allowed',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorBorder },
    opacity: 0.5,
    backgroundColor: cssVar.colorBgContainerDisabled,
  },
  featureIcon: { color: cssVar.colorTextSecondary },
  featureItem: { display: 'flex', gap: '8px', alignItems: 'center' },
  featureText: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextSecondary },
});

// Helper component for feature list items (moved from MCPManifestForm)
const FeatureItem = memo(({ children }: { children: React.ReactNode }) => {
  return (
    <div {...stylex.props(styles.featureItem)}>
      <Center className={stylex.props(styles.featureIcon).className}>
        <CheckIcon color={cssVar.colorSuccess} size={16} />
      </Center>
      <div {...stylex.props(styles.featureText)}>{children}</div>
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
            gap={12}
            key={itemValue}
            style={{ flex: 1 }} // Make cards take equal width
            className={
              stylex.props(styles.container, isActive && styles.active, disabled && styles.disabled)
                .className
            }
            onClick={disabled ? undefined : () => handleSelect(itemValue)}
          >
            <Center
              className={stylex.props(styles.checkIcon).className}
              style={{ opacity: isActive ? 1 : 0 }}
            >
              <CheckIcon size={14} />
            </Center>

            <Flexbox horizontal align={'flex-start'} gap={12}>
              <Center height={22}>
                <Icon icon={icon} style={{ fontSize: 16 }} />
              </Center>
              <Flexbox>
                <div {...stylex.props(styles.cardTitle)}>{label}</div>
                <div {...stylex.props(styles.cardDescription)}>{description}</div>
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
