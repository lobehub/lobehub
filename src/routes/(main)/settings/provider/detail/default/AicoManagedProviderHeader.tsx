'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { useAicoBillingSources } from '@/features/AicoBilling/useAicoBillingSources';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  desc: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

/**
 * Branded header for the managed Aico provider surface.
 * Replaces ProviderConfig so BYOK fields / OpenRouter docs never appear.
 */
const AicoManagedProviderHeader = memo(() => {
  const { t } = useTranslation('aico');
  const { data: billingSources } = useAicoBillingSources();
  const hasOrgMembership = (billingSources?.sources ?? []).some(
    (source) => source.source === 'organization',
  );

  return (
    <Flexbox gap={12}>
      <Flexbox className={styles.card} gap={8}>
        <Flexbox horizontal align={'center'} gap={10}>
          <ProductLogo size={28} type={'flat'} />
          <Text strong style={{ fontSize: 18 }}>
            {BRANDING_NAME}
          </Text>
        </Flexbox>
        <Text className={styles.desc} fontSize={13}>
          {t('provider.managed.desc', { brandName: BRANDING_NAME })}
        </Text>
      </Flexbox>
      {hasOrgMembership && (
        <Alert
          showIcon
          closable={false}
          description={t('provider.managed.orgModelsTip')}
          type={'info'}
        />
      )}
    </Flexbox>
  );
});

AicoManagedProviderHeader.displayName = 'AicoManagedProviderHeader';

export default AicoManagedProviderHeader;
