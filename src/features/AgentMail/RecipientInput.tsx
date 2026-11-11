'use client';

import type { AgentMailAddress } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatAddress,
  hasSeparator,
  isValidAddress,
  mergeAddresses,
  parseAddressList,
} from './compose';
import { composerStyles as styles } from './composerStyles';

export interface RecipientInputProps {
  'aria-label': string;
  'autoFocus'?: boolean;
  /** Shown, never edited: a reply's recipients are the original's. */
  'locked'?: boolean;
  'onChange': (value: AgentMailAddress[]) => void;
  'readOnly'?: boolean;
  'value': AgentMailAddress[];
}

/**
 * Recipients as chips. Typing a comma, semicolon or Enter, pasting a list, or
 * leaving the field turns the text into chips; one that is not an address is
 * marked on the chip itself, so the mistake is visible before sending.
 */
const RecipientInput = memo<RecipientInputProps>(
  ({ 'aria-label': label, autoFocus, locked, onChange, readOnly, value }) => {
    const { t } = useTranslation('setting');
    const [text, setText] = useState('');

    const commit = (raw: string) => {
      const added = parseAddressList(raw);
      setText('');
      if (added.length > 0) onChange(mergeAddresses(value, added));
    };

    const remove = (index: number) => onChange(value.filter((_, at) => at !== index));

    return (
      <div {...stylex.props(styles.fieldValue)} data-testid={'recipient-input'}>
        {value.map((item, index) => {
          const invalid = !isValidAddress(item.address);
          return (
            <span
              {...stylex.props(
                styles.chip,
                invalid && styles.chipInvalid,
                locked && styles.chipLocked,
              )}
              aria-invalid={invalid || undefined}
              data-testid={'recipient-chip'}
              key={`${item.address}-${index}`}
              title={invalid ? t('identity.compose.invalidAddress') : item.address}
            >
              <span {...stylex.props(styles.chipText)}>{formatAddress(item)}</span>
              {!locked && !readOnly && (
                <ActionIcon
                  aria-label={t('identity.compose.removeRecipient', { address: item.address })}
                  icon={X}
                  size={'small'}
                  onClick={() => remove(index)}
                />
              )}
            </span>
          );
        })}
        {!locked && (
          <input
            {...stylex.props(styles.input)}
            aria-label={label}
            autoFocus={autoFocus}
            readOnly={readOnly}
            type={'text'}
            value={text}
            onBlur={() => commit(text)}
            onChange={(event) => {
              const next = event.target.value;
              // A comma inside a quoted display name is part of the name.
              if (hasSeparator(next)) commit(next);
              else setText(next);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && text.trim()) {
                event.preventDefault();
                commit(text);
              }
              if (event.key === 'Backspace' && !text && value.length > 0) remove(value.length - 1);
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text');
              if (!hasSeparator(pasted)) return;
              event.preventDefault();
              commit(`${text}${pasted}`);
            }}
          />
        )}
      </div>
    );
  },
);

RecipientInput.displayName = 'AgentMailRecipientInput';

export default RecipientInput;
