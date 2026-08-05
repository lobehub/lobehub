'use client';

import { Block, Checkbox, Empty, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { HeartHandshake, Undo2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTelemetrySubmit } from '@/features/Onboarding';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import LobeMessage from '../components/LobeMessage';
import OnboardingFooterActions from '../components/OnboardingFooterActions';

interface DataModeStepProps {
  onBack: () => void;
  onNext: () => Promise<void> | void;
}

const DataModeStep = memo<DataModeStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');
  const persistedTelemetryEnabled = useUserStore(userGeneralSettingsSelectors.telemetry);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);
  const { handleSubmit, hasSaveError, isSaving, setTelemetryEnabled, telemetryEnabled } =
    useTelemetrySubmit({
      initialTelemetryEnabled: persistedTelemetryEnabled,
      onNext,
      updateGeneralConfig,
    });

  const checkIcon = (
    <Checkbox
      checked
      backgroundColor={cssVar.colorSuccess}
      shape={'circle'}
      size={20}
      style={{ position: 'absolute', right: 12, top: 12 }}
    />
  );

  return (
    <Flexbox gap={16} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox>
        <LobeMessage sentences={[t('screen4.title'), t('screen4.title2'), t('screen4.title3')]} />
        <Text as={'p'}>{t('screen4.description')}</Text>
      </Flexbox>
      <Flexbox gap={16} style={{ width: '100%' }}>
        {/* Shared data option */}
        <Block
          clickable
          flex={1}
          gap={16}
          padding={16}
          style={{ borderColor: telemetryEnabled ? cssVar.colorSuccess : undefined }}
          variant={'outlined'}
          onClick={() => setTelemetryEnabled(true)}
        >
          {telemetryEnabled && checkIcon}
          <Empty
            description={t('screen4.share.description')}
            icon={HeartHandshake}
            padding={0}
            title={t('screen4.share.title')}
            type={'page'}
            descriptionProps={{
              fontSize: 14,
            }}
            titleProps={{
              fontSize: 18,
            }}
          />
          <Flexbox as={'ul'} gap={4} style={{ listStyle: 'none', padding: 0 }}>
            <li>
              <Text>• {t('screen4.share.items.1')}</Text>
            </li>
            <li>
              <Text>• {t('screen4.share.items.2')}</Text>
            </li>
            <li>
              <Text>• {t('screen4.share.items.3')}</Text>
            </li>
          </Flexbox>
        </Block>

        {/* Privacy mode option */}
        <Block
          clickable
          flex={1}
          gap={6}
          padding={16}
          style={{ borderColor: !telemetryEnabled ? cssVar.colorSuccess : undefined }}
          variant={'outlined'}
          onClick={() => setTelemetryEnabled(false)}
        >
          {!telemetryEnabled && checkIcon}
          <Text strong fontSize={18}>
            {t('screen4.privacy.title')}
          </Text>
          <Text fontSize={14} type={'secondary'}>
            {t('screen4.privacy.description')}
          </Text>
        </Block>
      </Flexbox>
      <Text color={cssVar.colorTextSecondary} fontSize={12} style={{ marginTop: 16 }}>
        {t('screen4.footerNote')}
      </Text>
      {hasSaveError && (
        <Text color={cssVar.colorError} fontSize={12}>
          {t('screen4.errors.saveFailed')}
        </Text>
      )}
      <OnboardingFooterActions
        left={
          <Button
            disabled={isSaving}
            icon={Undo2Icon}
            style={{ color: cssVar.colorTextDescription }}
            type={'text'}
            onClick={onBack}
          >
            {t('back')}
          </Button>
        }
        right={
          <Button disabled={isSaving} loading={isSaving} type={'primary'} onClick={handleSubmit}>
            {t('next')}
          </Button>
        }
      />
    </Flexbox>
  );
});

DataModeStep.displayName = 'DataModeStep';

export default DataModeStep;
