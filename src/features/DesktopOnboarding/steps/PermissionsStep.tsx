'use client';

import { Block, Button, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Check,
  FolderOpen,
  Loader2Icon,
  Mic,
  Monitor,
  MonitorCog,
  Undo2Icon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LobeMessage from '../components/LobeMessage';
import OnboardingFooterActions from '../components/OnboardingFooterActions';
import type { PermissionId, PermissionStatus } from './usePermissionStatuses';
import { GUIDED_PERMISSIONS, PERMISSION_IDS, usePermissionStatuses } from './usePermissionStatuses';

const PERMISSION_META: Record<
  PermissionId,
  { descriptionKey: string; icon: LucideIcon; titleKey: string }
> = {
  accessibility: {
    descriptionKey: 'screen3.permissions.4.description',
    icon: MonitorCog,
    titleKey: 'screen3.permissions.4.title',
  },
  fullDisk: {
    descriptionKey: 'screen3.permissions.2.description',
    icon: FolderOpen,
    titleKey: 'screen3.permissions.2.title',
  },
  microphone: {
    descriptionKey: 'screen3.permissions.microphone.description',
    icon: Mic,
    titleKey: 'screen3.permissions.microphone.title',
  },
  notification: {
    descriptionKey: 'screen3.permissions.1.description',
    icon: Bell,
    titleKey: 'screen3.permissions.1.title',
  },
  screen: {
    descriptionKey: 'screen3.permissions.screen.description',
    icon: Monitor,
    titleKey: 'screen3.permissions.screen.title',
  },
};

const resolveDescriptionKey = (id: PermissionId, status: PermissionStatus) => {
  if (status === 'pending') {
    return GUIDED_PERMISSIONS.has(id) ? 'screen3.hint.guide' : 'screen3.hint.prompt';
  }
  if (status === 'incomplete') return 'screen3.hint.incomplete';
  return PERMISSION_META[id].descriptionKey;
};

interface PermissionsStepProps {
  onBack: () => void;
  onNext: () => void;
}

const PermissionsStep = memo<PermissionsStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');
  const { request, statuses } = usePermissionStatuses();

  return (
    <Flexbox gap={16} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox>
        <LobeMessage sentences={[t('screen3.title'), t('screen3.title2'), t('screen3.title3')]} />
        <Text as={'p'}>{t('screen3.description')}</Text>
      </Flexbox>
      <Block gap={12} padding={4} style={{ width: '100%' }} variant={'outlined'}>
        {PERMISSION_IDS.map((id) => {
          const status = statuses[id];
          const meta = PERMISSION_META[id];
          const actionable = status === 'idle' || status === 'incomplete';

          return (
            <Block
              horizontal
              align={'center'}
              clickable={actionable}
              gap={16}
              key={id}
              paddingBlock={8}
              paddingInline={'12px 12px'}
              variant={'borderless'}
              style={{
                background:
                  status === 'granted'
                    ? cssVar.colorFillSecondary
                    : status === 'pending'
                      ? cssVar.colorPrimaryBg
                      : undefined,
                boxShadow:
                  status === 'pending' ? `inset 0 0 0 1px ${cssVar.colorPrimaryBorder}` : undefined,
              }}
              onClick={actionable ? () => void request(id) : undefined}
            >
              <Block
                align={'center'}
                height={40}
                justify={'center'}
                variant={'outlined'}
                width={40}
                style={{
                  background: status === 'pending' ? cssVar.colorBgContainer : undefined,
                }}
              >
                <Icon color={cssVar.colorTextDescription} icon={meta.icon} size={20} />
              </Block>
              <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text weight={500}>{t(meta.titleKey as any)}</Text>
                <Text color={cssVar.colorTextSecondary} fontSize={12}>
                  {t(resolveDescriptionKey(id, status) as any)}
                </Text>
              </Flexbox>
              {status === 'granted' && <Icon color={cssVar.colorSuccess} icon={Check} size={20} />}
              {status === 'pending' && (
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={6}
                  style={{ color: cssVar.colorPrimaryText, flexShrink: 0, fontSize: 13 }}
                >
                  <Icon spin icon={Loader2Icon} size={14} />
                  {t('screen3.actions.waiting')}
                </Flexbox>
              )}
              {actionable && (
                <Button
                  size={'small'}
                  style={{ flexShrink: 0 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void request(id);
                  }}
                >
                  {t(
                    status === 'incomplete'
                      ? 'screen3.actions.continue'
                      : 'screen3.actions.grantAccess',
                  )}
                </Button>
              )}
            </Block>
          );
        })}
      </Block>
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

PermissionsStep.displayName = 'PermissionsStep';

export default PermissionsStep;
