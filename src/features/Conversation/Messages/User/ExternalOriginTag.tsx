'use client';

import type { ExternalOriginMetadata } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Tag } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const PROVIDER_ICON: Record<string, typeof Github> = { github: Github };

interface ExternalOriginTagProps {
  origin: ExternalOriginMetadata;
}

/**
 * Names the provider event that injected a user turn (GitHub: CI failed on
 * lobehub/lobehub#19728), linking to the resource when there is one.
 */
const ExternalOriginTag = memo<ExternalOriginTagProps>(({ origin }) => {
  const { t } = useTranslation('integration');
  const Icon = PROVIDER_ICON[origin.provider];
  const eventLabel = t(`origin.event.${origin.kind}` as any, { defaultValue: origin.kind });
  const label = `${t(`origin.provider.${origin.provider}` as any, { defaultValue: origin.provider })} · ${eventLabel} · ${origin.label}`;
  const tag = (
    <Tag icon={Icon ? <Icon size={12} /> : undefined} title={origin.url ?? label}>
      {label}
    </Tag>
  );
  return origin.url ? (
    <a href={origin.url} rel="noreferrer" style={{ color: 'inherit' }} target="_blank">
      {tag}
    </a>
  ) : (
    tag
  );
});

ExternalOriginTag.displayName = 'ExternalOriginTag';

export default ExternalOriginTag;
