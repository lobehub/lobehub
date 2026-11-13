import { ActionIcon, Flexbox, Icon, Tag, Text, TextArea, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { QuoteIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { floatStyles } from '../Canvas/Overlays';
import { addBoardReference } from '../data/addBoardReference';
import { boardReference } from '../data/references';
import { artboardActions, artboardSelectors, useArtboardStore } from '../store';
import { COMPOSER_INPUT_ID } from './focusComposer';

const styles = stylex.create({
  composer: {
    insetBlockEnd: 'calc(56px + env(safe-area-inset-bottom, 0px))',
    insetInline: 12,
    marginInline: 'auto',
    maxWidth: 520,
    paddingBlock: 8,
    paddingInline: 10,
  },
});

const Composer = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const [text, setText] = useState('');
  const selected = useArtboardStore((s) => (s.mode === 'discuss' ? s.selected : null));
  const locked = useArtboardStore(artboardSelectors.isQuoteLocked(board));
  const reference = selected ? boardReference(board, selected, text) : undefined;
  if (!selected || !reference) return null;

  const send = () => {
    if (!reference.text) return;
    if (!addBoardReference(reference)) return toast.error(t('artboard.chat.noInput'));
    setText('');
    artboardActions.select(null);
  };

  return (
    <Flexbox gap={6} {...stylex.props(floatStyles.float, styles.composer)}>
      <Flexbox horizontal align="center" gap={8}>
        <Tag
          closable
          icon={<Icon icon={QuoteIcon} />}
          size={'small'}
          style={{ maxWidth: '100%' }}
          onClose={() => artboardActions.select(null)}
        >
          {t('artboard.chat.quote', { target: reference.itemTitle })}
        </Tag>
      </Flexbox>
      {locked && (
        <Text style={{ fontSize: 12 }} type="warning">
          {t('artboard.chat.lockedHint')}
        </Text>
      )}
      <Flexbox horizontal align="flex-end" gap={6}>
        <TextArea
          autoSize={{ maxRows: 4, minRows: 1 }}
          id={COMPOSER_INPUT_ID}
          placeholder={t('artboard.chat.placeholderQuote')}
          style={{ flex: 1 }}
          value={text}
          variant={'borderless'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <ActionIcon
          disabled={!reference.text}
          icon={SendIcon}
          size={'small'}
          title={t('artboard.chat.addReference')}
          onClick={send}
        />
      </Flexbox>
    </Flexbox>
  );
};

export default Composer;
