import { Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Link2Icon, ServerIcon } from 'lucide-react';
import Image from 'next/image';
import React, { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import { ProductLogo } from '@/components/Branding';

const useStyles = createStyles(({ css, token }) => ({
  connector: css`
    width: 40px;
    height: 40px;

    @media (max-width: 768px) {
      width: 32px;
      height: 32px;
    }
  `,
  connectorLine: css`
    width: 32px;
    height: 1px;
    background-color: ${token.colorBorderSecondary};

    @media (max-width: 768px) {
      width: 24px;
    }
  `,
  icon: css`
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    width: 64px;
    height: 64px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;

    background-color: ${token.colorBgElevated};

    @media (max-width: 768px) {
      width: 48px;
      height: 48px;
      border-radius: 12px;
    }
  `,
  lobeIcon: css`
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    width: 64px;
    height: 64px;
    border-radius: 50%;

    background-color: ${token.colorBgElevated};

    @media (max-width: 768px) {
      width: 48px;
      height: 48px;
    }
  `,
}));

interface OAuthApplicationLogoProps {
  clientDisplayName: string;
  isFirstParty?: boolean;
  logoUrl?: string;
}

const OAuthApplicationLogo = memo<OAuthApplicationLogoProps>(
  ({ isFirstParty, clientDisplayName, logoUrl }) => {
    const { styles, theme } = useStyles();
    return isFirstParty ? (
      <Flexbox align={'center'} gap={12} horizontal justify={'center'}>
        {logoUrl ? (
          <Image
            alt={clientDisplayName}
            height={64}
            src={logoUrl}
            style={{ height: 'auto', maxWidth: '100%' }}
            unoptimized
            width={64}
          />
        ) : (
          <ProductLogo height={64} style={{ height: 'auto', maxWidth: '100%' }} width={64} />
        )}
      </Flexbox>
    ) : (
      <Flexbox align={'center'} gap={12} horizontal justify={'center'}>
        <div className={styles.icon}>
          {logoUrl ? (
            <Image
              alt={clientDisplayName}
              height={56}
              src={logoUrl}
              style={{ height: 'auto', maxWidth: '100%' }}
              unoptimized
              width={56}
            />
          ) : (
            <Icon icon={ServerIcon} />
          )}
        </div>
        <div className={styles.connectorLine} />
        <Center className={styles.connector}>
          <Icon icon={Link2Icon} style={{ color: theme.colorTextSecondary, fontSize: 20 }} />
        </Center>
        <div className={styles.connectorLine} />
        <div className={styles.lobeIcon}>
          <ProductLogo
            height={48}
            style={{ height: 'auto', maxWidth: '100%', objectFit: 'cover' }}
            width={48}
          />
        </div>
      </Flexbox>
    );
  },
);

export default OAuthApplicationLogo;
