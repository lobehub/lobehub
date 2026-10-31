import { Avatar, Center, Flexbox, FluentEmoji, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Link2Icon } from 'lucide-react';
import React, { memo } from 'react';

import { ProductLogo } from '@/components/Branding';

const styles = stylex.create({
  connector: {
    width: { 'default': '40px', '@media (width <= 768px)': '32px' },
    height: { 'default': '40px', '@media (width <= 768px)': '32px' },
  },
  connectorLine: {
    width: { 'default': '24px', '@media (width <= 768px)': '24px' },
    height: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
  },
});

interface OAuthApplicationLogoProps {
  clientDisplayName: string;
  isFirstParty?: boolean;
  logoUrl?: string;
  size?: number;
}

const OAuthApplicationLogo = memo<OAuthApplicationLogoProps>(
  ({ isFirstParty, clientDisplayName, logoUrl, size = 72 }) => {
    return isFirstParty ? (
      <Center>
        <Avatar alt={clientDisplayName} avatar={logoUrl!} shape={'square'} size={size} />
      </Center>
    ) : (
      <Flexbox horizontal align={'center'} gap={8} justify={'center'}>
        {logoUrl ? (
          <Avatar alt={clientDisplayName} avatar={logoUrl} size={size} />
        ) : (
          <FluentEmoji emoji={'🔐'} size={size} />
        )}
        <div {...stylex.props(styles.connectorLine)} />
        <Center className={stylex.props(styles.connector).className}>
          <Icon icon={Link2Icon} style={{ color: cssVar.colorTextSecondary, fontSize: 20 }} />
        </Center>
        <div {...stylex.props(styles.connectorLine)} />
        <ProductLogo size={size} />
      </Flexbox>
    );
  },
);

export default OAuthApplicationLogo;
