'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ModuleSaveBarProps {
  dirty: boolean;
  disabled?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  saving?: boolean;
}

/**
 * The Save button in the corner of a settings block.
 *
 * It is always shown, so a person sees at a glance that this block is saved by hand (unlike the
 * replies, which save themselves), and it can only be pressed once something in the block changed.
 * With a change pending it says so and offers to put the block back.
 */
export const ModuleSaveBar = memo<ModuleSaveBarProps>(
  ({ dirty, disabled, onDiscard, onSave, saving }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string) => string;

    return (
      <Flexbox horizontal align={'center'} gap={8}>
        {dirty && (
          <Text fontSize={12} type={'warning'}>
            {t('channel.module.unsaved')}
          </Text>
        )}
        {dirty && (
          <Button disabled={disabled || saving} size={'small'} type={'text'} onClick={onDiscard}>
            {t('channel.discard')}
          </Button>
        )}
        <Button
          disabled={disabled || !dirty}
          loading={saving}
          size={'small'}
          type={dirty ? 'primary' : 'default'}
          onClick={onSave}
        >
          {t('channel.module.save')}
        </Button>
      </Flexbox>
    );
  },
);

ModuleSaveBar.displayName = 'ChannelModuleSaveBar';
