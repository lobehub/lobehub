'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type CSSProperties, type FC, type PropsWithChildren, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import Banner from './Banner';
import { styles } from './style';

interface StepCardProps extends PropsWithChildren {
  bannerContent?: ReactNode;
  bannerSrc?: string;
  bodyStyle?: CSSProperties;
  continueDisabled?: boolean;
  continueLabel?: string;
  continueLoading?: boolean;
  description?: ReactNode;
  footerHint?: ReactNode;
  hideBanner?: boolean;
  onBack?: () => void;
  onContinue: () => void;
  title?: ReactNode;
  titleExtra?: ReactNode;
}

const StepCard: FC<StepCardProps> = ({
  bannerContent,
  bannerSrc,
  bodyStyle,
  children,
  continueDisabled,
  continueLabel,
  continueLoading,
  description,
  footerHint,
  hideBanner,
  onBack,
  onContinue,
  title,
  titleExtra,
}) => {
  const { t } = useTranslation('onboarding');

  return (
    <Flexbox className={styles.card}>
      {!hideBanner && (
        <Banner src={bannerSrc} onBack={onBack}>
          {bannerContent}
        </Banner>
      )}
      <Flexbox className={styles.body} gap={20} style={bodyStyle}>
        {(title || description) && (
          <Flexbox gap={4}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Text as={'h1'} className={styles.title}>
                {title}
              </Text>
              {titleExtra}
            </Flexbox>
            {description && <Text className={styles.description}>{description}</Text>}
          </Flexbox>
        )}
        {children}
      </Flexbox>
      <Flexbox horizontal align={'center'} className={styles.footer} justify={'space-between'}>
        <Text className={styles.hint}>{footerHint ?? t('flow.footer.hint')}</Text>
        <Button
          disabled={continueDisabled}
          loading={continueLoading}
          shape={'round'}
          type={'primary'}
          onClick={onContinue}
        >
          {continueLabel ?? t('flow.footer.continue')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default StepCard;
