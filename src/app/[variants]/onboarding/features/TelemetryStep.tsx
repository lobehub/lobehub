'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Block, Button, Flexbox, Icon, type IconProps, Text } from '@lobehub/ui';
import { TypewriterEffect } from '@lobehub/ui/awesome';
import { LoadingDots } from '@lobehub/ui/chat';
import { Steps, Switch } from 'antd';
import { cssVar } from 'antd-style';
import { BrainIcon, HeartHandshakeIcon, PencilRulerIcon, ShieldCheck } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { PRIVACY_URL, TERMS_URL } from '@/const/url';
import { useUserStore } from '@/store/user';

interface TelemetryStepProps {
  onNext: () => void;
}

const TelemetryStep = memo<TelemetryStepProps>(({ onNext }) => {
  const { t } = useTranslation('onboarding');
  const [check, setCheck] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);

  const handleChoice = useCallback(
    (enabled: boolean) => {
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;
      setIsNavigating(true);
      updateGeneralConfig({ telemetry: enabled });
      onNext();
    },
    [updateGeneralConfig, onNext],
  );

  const IconAvatar = useCallback(({ icon }: { icon: IconProps['icon'] }) => {
    return (
      <Block
        align="center"
        height={32}
        justify="center"
        padding={4}
        shadow
        variant="outlined"
        width={32}
      >
        <Icon color={cssVar.colorTextDescription} icon={icon} size={16} />
      </Block>
    );
  }, []);

  return (
    <Flexbox gap={16}>
      <ProductLogo size={64} />
      <Flexbox style={{ marginBottom: 16 }}>
        <Text as={'h1'} fontSize={28} weight={'bold'}>
          <TypewriterEffect
            cursorCharacter={<LoadingDots size={28} variant={'pulse'} />}
            cursorFade={false}
            deletePauseDuration={1000}
            deletingSpeed={32}
            hideCursorWhileTyping={'afterTyping'}
            pauseDuration={16_000}
            sentences={[
              t('telemetry.title', { name: 'Lobe AI' }),
              t('telemetry.title2'),
              t('telemetry.title3'),
            ]}
            typingSpeed={64}
          />
        </Text>
        <Text as={'p'}>{t('telemetry.desc')}</Text>
      </Flexbox>
      <Steps
        current={null as any}
        direction={'vertical'}
        items={[
          {
            description: (
              <Text as={'p'} color={cssVar.colorTextSecondary} style={{ marginBottom: 16 }}>
                {t('telemetry.rows.create.desc')}
              </Text>
            ),
            icon: <IconAvatar icon={PencilRulerIcon} />,
            title: (
              <Text as={'h2'} fontSize={16}>
                {t('telemetry.rows.create.title')}
              </Text>
            ),
          },
          {
            description: (
              <Text as={'p'} color={cssVar.colorTextSecondary} style={{ marginBottom: 16 }}>
                {t('telemetry.rows.collaborate.desc')}
              </Text>
            ),
            icon: <IconAvatar icon={HeartHandshakeIcon} />,
            title: (
              <Text as={'h2'} fontSize={16}>
                {t('telemetry.rows.collaborate.title')}
              </Text>
            ),
          },
          {
            description: (
              <Text as={'p'} color={cssVar.colorTextSecondary}>
                {t('telemetry.rows.evolve.desc')}
              </Text>
            ),
            icon: <IconAvatar icon={BrainIcon} />,
            title: (
              <Text as={'h2'} fontSize={16}>
                {t('telemetry.rows.evolve.title')}
              </Text>
            ),
          },
        ]}
      />
      <Flexbox gap={8}>
        <Text as={'p'} color={cssVar.colorTextSecondary}>
          {t('telemetry.rows.privacy.desc', { appName: BRANDING_NAME })}
        </Text>
        <Flexbox align="center" gap={8} horizontal>
          <Switch checked={check} onChange={(v) => setCheck(v)} size={'small'} />
          <Text fontSize={12} type={check ? undefined : 'secondary'}>
            {t('telemetry.rows.privacy.title', { appName: BRANDING_NAME })}
          </Text>
        </Flexbox>
      </Flexbox>
      <Button
        disabled={isNavigating}
        onClick={() => handleChoice(check)}
        size={'large'}
        style={{
          marginBlock: 8,
          maxWidth: 240,
        }}
        type="primary"
      >
        {t('telemetry.next')}
      </Button>
      {check && (
        <Block align="flex-start" gap={8} horizontal variant={'borderless'}>
          <Icon
            icon={ShieldCheck}
            size={16}
            style={{ color: cssVar.colorSuccess, flexShrink: 0 }}
          />
          <Text fontSize={12} type="secondary">
            <Trans
              components={{
                privacy: (
                  <a
                    href={PRIVACY_URL}
                    style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {t('telemetry.terms')}
                  </a>
                ),
                terms: (
                  <a
                    href={TERMS_URL}
                    style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {t('telemetry.privacy')}
                  </a>
                ),
              }}
              i18nKey={'telemetry.agreement'}
              ns={'onboarding'}
            />
          </Text>
        </Block>
      )}
    </Flexbox>
  );
});

TelemetryStep.displayName = 'TelemetryStep';

export default TelemetryStep;
