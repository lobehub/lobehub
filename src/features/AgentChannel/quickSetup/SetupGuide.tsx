'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ExternalLinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SetupGuide as SetupGuideModel } from './guides';

const styles = createStaticStyles(({ css }) => ({
  index: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 22px;
    height: 22px;
    border-radius: 50%;

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
}));

/**
 * A platform's setup as numbered steps, each with a button straight to the
 * console page it happens on. Steps that need the app ID say so until the
 * form has it.
 */
const SetupGuide = memo<{ guide: SetupGuideModel }>(({ guide }) => {
  const { t } = useTranslation('agent');
  const prefix = `channel.quickSetup.${guide.guide}`;

  return (
    <Flexbox data-testid={'channel-setup-guide'} gap={14}>
      {guide.steps.map((step, index) => (
        <Flexbox horizontal align={'flex-start'} gap={10} key={step.key}>
          <span className={styles.index}>{index + 1}</span>
          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Text fontSize={13} weight={600}>
              {t(`${prefix}.${step.key}.title` as any)}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {t(`${prefix}.${step.key}.desc` as any)}
            </Text>
            {step.link && (
              <a
                href={step.link.href}
                rel={'noreferrer'}
                style={{ alignSelf: 'flex-start' }}
                target={'_blank'}
              >
                <Button icon={<Icon icon={ExternalLinkIcon} />} size={'small'}>
                  {t(`channel.quickSetup.link.${step.link.label}`)}
                </Button>
              </a>
            )}
            {step.needsApplicationId && (
              <Text fontSize={12} type={'secondary'}>
                {t('channel.quickSetup.needsApplicationId')}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

SetupGuide.displayName = 'ChannelSetupGuide';

export default SetupGuide;
