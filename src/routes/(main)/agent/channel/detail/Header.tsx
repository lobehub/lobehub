'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Switch } from 'antd';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InfoTooltip from '@/components/InfoTooltip';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import { getPlatformIcon } from '../const';

interface HeaderProps {
  currentConfig?: { enabled: boolean };
  onToggleEnable: (enabled: boolean) => void;
  platformDef: SerializedPlatformDefinition;
}

const Header = memo<HeaderProps>(({ platformDef, currentConfig, onToggleEnable }) => {
  const { t } = useTranslation('agent');
  const PlatformIcon = getPlatformIcon(platformDef.name);
  const ColorIcon =
    PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      style={{
        borderBottom: '1px solid var(--ant-color-border)',
        maxWidth: 1024,
        padding: '16px 0',
        width: '100%',
      }}
    >
      <Flexbox horizontal align="center" gap={8}>
        {ColorIcon && <ColorIcon size={32} />}
        {platformDef.name}
        {platformDef.documentation?.setupGuideUrl && (
          <a
            href={platformDef.documentation.setupGuideUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <InfoTooltip title={t('channel.setupGuide')} />
          </a>
        )}
      </Flexbox>
      <Flexbox horizontal align="center" gap={8}>
        {platformDef.documentation?.portalUrl && (
          <a href={platformDef.documentation.portalUrl} rel="noopener noreferrer" target="_blank">
            <Button icon={<ExternalLink size={14} />} size="small" type="link">
              {t('channel.openPlatform')}
            </Button>
          </a>
        )}
        {currentConfig && <Switch checked={currentConfig.enabled} onChange={onToggleEnable} />}
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
