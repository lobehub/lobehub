'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type FC, type PropsWithChildren, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import Banner from './Banner';
import { styles } from './style';

interface StepCardProps extends PropsWithChildren {
  bannerSrc?: string;
  continueDisabled?: boolean;
  continueLabel?: string;
  continueLoading?: boolean;
  description?: ReactNode;
  onBack?: () => void;
  onContinue: () => void;
  title: ReactNode;
  titleExtra?: ReactNode;
}

const StepCard: FC<StepCardProps> = ({
  bannerSrc,
  children,
  continueDisabled,
  continueLabel,
  continueLoading,
  description,
  onBack,
  onContinue,
  title,
  titleExtra,
}) => {
  const { t } = useTranslation('onboarding');

  return (
    <Flexbox className={styles.card}>
      <Banner src={bannerSrc} onBack={onBack} />
      <Flexbox className={styles.body} gap={20}>
        <Flexbox gap={4}>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Text as={'h1'} className={styles.title}>
              {title}
            </Text>
            {titleExtra}
          </Flexbox>
          {description && <Text className={styles.description}>{description}</Text>}
        </Flexbox>
        {children}
      </Flexbox>
      <Flexbox horizontal align={'center'} className={styles.footer} justify={'space-between'}>
        <Text className={styles.hint}>{t('flow.footer.hint')}</Text>
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
