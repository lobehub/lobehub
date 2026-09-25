'use client';

import { Block, Empty, Flexbox } from '@lobehub/ui';
import { Button, Checkbox, Tag, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { MonitorCheck, Undo2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGatewayKeepAwake } from '@/features/Electron/connection/useGatewayKeepAwake';

import LobeMessage from '../components/LobeMessage';
import OnboardingFooterActions from '../components/OnboardingFooterActions';

interface KeepAwakeStepProps {
  onBack: () => void;
  onNext: () => void;
}

/**
 * Let the user decide up front whether this computer may idle-sleep while it
 * is connected as a device. Sleeping drops the device offline, so remote runs
 * that target it fail until the user comes back.
 */
const KeepAwakeStep = memo<KeepAwakeStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');
  const { enabled, setKeepAwake } = useGatewayKeepAwake();
  // The store defaults to on; treat the pre-load state the same way.
  const keepAwake = enabled ?? true;

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
        <LobeMessage
          sentences={[t('keepAwake.title'), t('keepAwake.title2'), t('keepAwake.title3')]}
        />
        <Text as={'p'}>{t('keepAwake.description')}</Text>
      </Flexbox>
      <Flexbox gap={16} style={{ width: '100%' }}>
        <Block
          clickable
          gap={16}
          padding={16}
          style={{ borderColor: keepAwake ? cssVar.colorSuccess : undefined }}
          variant={'outlined'}
          onClick={() => void setKeepAwake(true)}
        >
          {keepAwake && checkIcon}
          <Empty
            description={t('keepAwake.on.description')}
            icon={MonitorCheck}
            padding={0}
            type={'page'}
            descriptionProps={{
              fontSize: 14,
            }}
            title={
              <Flexbox horizontal align={'center'} gap={8}>
                {t('keepAwake.on.title')}
                <Tag color={'success'}>{t('keepAwake.on.badge')}</Tag>
              </Flexbox>
            }
            titleProps={{
              fontSize: 18,
            }}
          />
        </Block>
        <Block
          clickable
          gap={6}
          padding={16}
          style={{ borderColor: keepAwake ? undefined : cssVar.colorSuccess }}
          variant={'outlined'}
          onClick={() => void setKeepAwake(false)}
        >
          {!keepAwake && checkIcon}
          <Text strong fontSize={18}>
            {t('keepAwake.off.title')}
          </Text>
          <Text fontSize={14} type={'secondary'}>
            {t('keepAwake.off.description')}
          </Text>
        </Block>
      </Flexbox>
      <Text color={cssVar.colorTextSecondary} fontSize={12} style={{ marginTop: 16 }}>
        {t('keepAwake.footerNote')}
      </Text>
      <OnboardingFooterActions
        left={
          <Button
            icon={Undo2Icon}
            style={{ color: cssVar.colorTextDescription }}
            type={'text'}
            onClick={onBack}
          >
            {t('back')}
          </Button>
        }
        right={
          <Button type={'primary'} onClick={onNext}>
            {t('next')}
          </Button>
        }
      />
    </Flexbox>
  );
});

KeepAwakeStep.displayName = 'KeepAwakeStep';

export default KeepAwakeStep;
