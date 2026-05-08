'use client';

import { SendButton } from '@lobehub/editor/react';
import { type IconProps } from '@lobehub/ui';
import { Block, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { TypewriterEffect } from '@lobehub/ui/awesome';
import { LoadingDots } from '@lobehub/ui/chat';
import { Steps } from 'antd';
import { cssVar } from 'antd-style';
import { BrainIcon, HeartHandshakeIcon, PencilRulerIcon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import type { Locales } from '@/locales/resources';
import { localeOptions, normalizeLocale } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';

interface IntroLanguageStepProps {
  onNext: () => Promise<void> | void;
}

const IntroLanguageStep = memo<IntroLanguageStepProps>(({ onNext }) => {
  const { t, i18n } = useTranslation(['onboarding', 'common']);
  const locale = i18n.language;
  const switchLocale = useGlobalStore((s) => s.switchLocale);
  const setSettings = useUserStore((s) => s.setSettings);

  const [value, setValue] = useState<Locales | ''>(() => normalizeLocale(navigator.language));
  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);

  const handleNext = useCallback(async () => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    await setSettings({ general: { responseLanguage: value || '' } });
    await onNext();
  }, [value, setSettings, onNext]);

  // eslint-disable-next-line @eslint-react/no-nested-component-definitions
  const IconAvatar = useCallback(({ icon }: { icon: IconProps['icon'] }) => {
    return (
      <Block
        shadow
        align="center"
        height={32}
        justify="center"
        padding={4}
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
            key={locale}
            pauseDuration={16_000}
            typingSpeed={64}
            sentences={[
              t('telemetry.title', { name: 'Lobe AI' }),
              t('telemetry.title2'),
              t('telemetry.title3'),
            ]}
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
      <Flexbox horizontal align={'center'} gap={12}>
        <Select
          showSearch
          options={localeOptions}
          size="large"
          value={value}
          optionRender={(item) => (
            <Flexbox key={item.value}>
              <Text>{item.label}</Text>
              <Text fontSize={12} type={'secondary'}>
                {t(`lang.${item.value}` as any, { ns: 'common' })}
              </Text>
            </Flexbox>
          )}
          style={{
            fontSize: 20,
            fontWeight: 'bold',
            width: '100%',
          }}
          onChange={(v) => {
            if (v) {
              switchLocale(v);
              setValue(v);
            }
          }}
        />
        <SendButton
          disabled={isNavigating}
          style={{ zoom: 1.5 }}
          type="primary"
          onClick={handleNext}
        />
      </Flexbox>
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('responseLanguage.hint')}
      </Text>
    </Flexbox>
  );
});

IntroLanguageStep.displayName = 'IntroLanguageStep';

export default IntroLanguageStep;
