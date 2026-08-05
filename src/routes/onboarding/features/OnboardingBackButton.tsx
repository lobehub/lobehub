'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Undo2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    color: ${cssVar.colorTextDescription};

    &:dir(rtl) svg {
      transform: scaleX(-1);
    }
  `,
}));

interface OnboardingBackButtonProps {
  disabled?: boolean;
  /** Namespace that owns the `back` key. Defaults to web onboarding. */
  i18nNs?: 'desktop-onboarding' | 'onboarding';
  onClick: () => void;
}

const OnboardingBackButton = memo<OnboardingBackButtonProps>(
  ({ disabled, i18nNs = 'onboarding', onClick }) => {
    const { t } = useTranslation(i18nNs);

    return (
      <Button
        className={styles.root}
        disabled={disabled}
        icon={Undo2Icon}
        type={'text'}
        onClick={onClick}
      >
        {t('back')}
      </Button>
    );
  },
);

OnboardingBackButton.displayName = 'OnboardingBackButton';

export default OnboardingBackButton;
