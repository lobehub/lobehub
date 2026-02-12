'use client';

import { Block, Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Undo2Icon } from 'lucide-react';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LobeMessage from '@/app/[variants]/onboarding/components/LobeMessage';
import { useIsDark } from '@/hooks/useIsDark';
import { useUserStore } from '@/store/user';

const styles = createStaticStyles(({ css, cssVar }) => ({
  base: css`
    position: relative;
    padding-inline-end: 160px;
    transition: all 0.25s ease-in-out;

    &::before {
      content: '';

      position: absolute;
      z-index: 0;
      inset: 0;

      width: 100%;
      height: 100%;

      opacity: 0.5;
      background-repeat: no-repeat;
      background-position: 100% 100%;
      background-size: auto 120px;

      transition: all 0.25s ease-in-out;
    }

    &:hover {
      border-inline-end-width: 3px;

      &::before {
        opacity: 1;
      }
    }
  `,
  disabled: css`
    transform: scale(1) !important;
    opacity: 1 !important;
  `,
  lite: css`
    &:hover {
      border-inline-end-color: ${cssVar.purple};
    }

    &::before {
      z-index: 0;
      background-image: var(--lite-img);
    }
  `,
  pro: css`
    &:hover {
      border-inline-end-color: ${cssVar.gold};
    }

    &::before {
      z-index: 0;
      background-image: var(--pro-img);
    }
  `,
}));

interface ModeSelectionStepProps {
  onBack: () => void;
  onNext: () => void;
}

const ModeSelectionStep = memo<ModeSelectionStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const isDarkMode = useIsDark();

  const imageStyles = useMemo<React.CSSProperties>(
    () =>
      ({
        '--lite-img': `url('${isDarkMode ? '/images/mode_lite_dark.webp' : '/images/mode_lite_light.webp'}')`,
        '--pro-img': `url('${isDarkMode ? '/images/mode_pro_dark.webp' : '/images/mode_pro_light.webp'}')`,
      }) as React.CSSProperties,
    [isDarkMode],
  );

  const [updateGeneralConfig, finishOnboarding] = useUserStore((s) => [
    s.updateGeneralConfig,
    s.finishOnboarding,
  ]);

  const handleSelectLite = () => {
    updateGeneralConfig({ isLiteMode: true });
    finishOnboarding();
    navigate('/');
  };

  const handleSelectPro = () => {
    updateGeneralConfig({ isLiteMode: false });
    onNext();
  };

  return (
    <Flexbox>
      <LobeMessage
        sentences={[t('modeSelection.title'), t('modeSelection.title2'), t('modeSelection.title3')]}
      />
      <Text type={'secondary'}>{t('modeSelection.hint')}</Text>
      <Flexbox gap={16} paddingBlock={24}>
        {/* Lite Mode Option */}
        <Block
          clickable
          className={cx(styles.base, styles.lite)}
          padding={16}
          style={imageStyles}
          variant={'outlined'}
          onClick={handleSelectLite}
        >
          <Flexbox
            gap={8}
            style={{
              zIndex: 10,
            }}
          >
            <Text strong as={'h2'} fontSize={18}>
              {t('modeSelection.lite.title')}
            </Text>
            <Text as={'p'}>{t('modeSelection.lite.subtitle')}</Text>
            <Text as={'p'} type={'secondary'}>
              {t('modeSelection.lite.desc')}
            </Text>
          </Flexbox>
        </Block>

        {/* Pro Mode Option */}
        <Block
          clickable
          className={cx(styles.base, styles.pro)}
          padding={16}
          style={imageStyles}
          variant={'outlined'}
          onClick={handleSelectPro}
        >
          <Flexbox
            gap={8}
            style={{
              zIndex: 10,
            }}
          >
            <Text strong as={'h2'} fontSize={18}>
              {t('modeSelection.pro.title')}
            </Text>
            <Text as={'p'}>{t('modeSelection.pro.subtitle')}</Text>
            <Text as={'p'} type={'secondary'}>
              {t('modeSelection.pro.desc')}
            </Text>
          </Flexbox>
        </Block>
      </Flexbox>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Button
          icon={Undo2Icon}
          type={'text'}
          style={{
            color: cssVar.colorTextDescription,
          }}
          onClick={onBack}
        >
          {t('back')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ModeSelectionStep.displayName = 'ModeSelectionStep';

export default ModeSelectionStep;
