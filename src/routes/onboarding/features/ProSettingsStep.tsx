'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Undo2Icon } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSelect from '@/features/ModelSelect';
import LobeMessage from '@/routes/onboarding/components/LobeMessage';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import KlavisServerList from '../components/KlavisServerList';

interface ProSettingsStepProps {
  onBack: () => void;
  onNext: () => void;
}

const ProSettingsStep = memo<ProSettingsStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('onboarding');

  const enableKlavis = useServerConfigStore(serverConfigSelectors.enableKlavis);

  const updateDefaultModel = useUserStore((s) => s.updateDefaultModel);

  const defaultAgentConfig = useUserStore(
    (s) => settingsSelectors.currentSettings(s).defaultAgent?.config,
  );

  const [isNavigating, setIsNavigating] = useState(false);
  const isNavigatingRef = useRef(false);

  const handleNext = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    onNext();
  }, [onNext]);

  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setIsNavigating(true);
    onBack();
  }, [onBack]);

  const handleModelChange = useCallback(
    ({ model, provider }: { model: string; provider: string }) => {
      updateDefaultModel(model, provider);
    },
    [updateDefaultModel],
  );

  return (
    <Flexbox gap={16}>
      <LobeMessage
        sentences={[t('proSettings.title'), t('proSettings.title2'), t('proSettings.title3')]}
      />
      <Flexbox gap={16}>
        <Text color={cssVar.colorTextSecondary}>{t('proSettings.model.title')}</Text>
        <ModelSelect
          showAbility={false}
          size="large"
          style={{ width: '100%' }}
          value={defaultAgentConfig}
          onChange={handleModelChange}
        />
      </Flexbox>

      {enableKlavis && (
        <Flexbox gap={16}>
          <Text color={cssVar.colorTextSecondary}>{t('proSettings.connectors.title')}</Text>
          <KlavisServerList />
        </Flexbox>
      )}

      <Flexbox horizontal align={'center'} justify={'space-between'} style={{ marginTop: 16 }}>
        <Button
          disabled={isNavigating}
          icon={Undo2Icon}
          type={'text'}
          style={{
            color: cssVar.colorTextDescription,
          }}
          onClick={handleBack}
        >
          {t('back')}
        </Button>
        <Button
          disabled={isNavigating}
          style={{ minWidth: 120 }}
          type="primary"
          onClick={handleNext}
        >
          {t('next')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ProSettingsStep.displayName = 'ProSettingsStep';

export default ProSettingsStep;
