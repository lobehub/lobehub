'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorBgContainer,
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    display: 'flex',
    insetBlockEnd: 0,
    justifyContent: 'center',
    paddingBlock: 12,
    paddingInline: 24,
    position: 'sticky',
    width: '100%',
    zIndex: 10,
  },
  inner: {
    maxWidth: 1024,
    width: '100%',
  },
});

interface SaveBarProps {
  connecting: boolean;
  hasConfig: boolean;
  isDirty: boolean;
  onDiscard: () => void;
  onSave: () => void;
  saving: boolean;
  writeDisabled?: boolean;
}

/**
 * Pinned to the bottom of the page so saving stays in reach wherever the
 * operator is editing. Saving also (re)connects the bot, so the first save says
 * so and the button reports the connect step.
 */
const SaveBar = memo<SaveBarProps>(
  ({ connecting, hasConfig, isDirty, onDiscard, onSave, saving, writeDisabled }) => {
    const { t } = useTranslation('agent');
    const busy = saving || connecting;

    const status = isDirty
      ? t('channel.saveBar.unsaved')
      : hasConfig
        ? undefined
        : t('channel.saveBar.firstSave');

    return (
      <div {...stylex.props(styles.bar)} data-testid={'channel-save-bar'}>
        <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.inner)}>
          <Text style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
            {status}
          </Text>
          {isDirty && (
            <Button disabled={writeDisabled || busy} onClick={onDiscard}>
              {t('channel.discard')}
            </Button>
          )}
          <Button
            disabled={writeDisabled}
            loading={busy}
            type={isDirty || !hasConfig ? 'primary' : 'default'}
            onClick={onSave}
          >
            {connecting
              ? t('channel.connecting')
              : hasConfig
                ? t('channel.save')
                : t('channel.saveAndConnect')}
          </Button>
        </Flexbox>
      </div>
    );
  },
);

SaveBar.displayName = 'ChannelSaveBar';

export default SaveBar;
