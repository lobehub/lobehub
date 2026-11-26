import { ActionIcon, Center, cssVar, Flexbox, Input } from '@lobehub/ui';
import { Sparkles } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface InlineTitleEditorProps {
  /** The row's leading icon, kept in place so the row doesn't shift while editing. */
  icon?: ReactNode;
  /** Generates a title from the conversation instead of the typed one. */
  onAutoRename: () => void;
  /** Leaves edit mode. */
  onClose: () => void;
  onSave: (title: string) => void;
  title: string;
}

/**
 * Edits a topic title in place of the sidebar row. Enter or leaving the field
 * saves, Escape discards; an empty or unchanged title saves nothing.
 */
const InlineTitleEditor = memo<InlineTitleEditorProps>(
  ({ icon, onAutoRename, onClose, onSave, title }) => {
    const { t } = useTranslation('topic');
    const inputRef = useRef<HTMLInputElement>(null);
    // Enter and the auto-rename button both end editing, and the unmount that
    // follows blurs the input once more — finish only once.
    const finishedRef = useRef(false);
    // Compare against the title the edit started from: a generated title can
    // land mid-edit, and an untouched input must not write the old one back.
    const [initialTitle] = useState(title);

    useEffect(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, []);

    const finish = (save: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;

      const value = inputRef.current?.value.trim() ?? '';
      if (save && value && value !== initialTitle) onSave(value);
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      // Keep the keys away from list-level shortcuts while typing.
      event.stopPropagation();
      // Safari fires the candidate-confirming Enter after compositionend, with
      // isComposing already false; keyCode 229 still marks it as IME input.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    };

    return (
      <Flexbox
        horizontal
        align={'center'}
        data-testid="topic-title-editor"
        gap={8}
        height={36}
        paddingInline={4}
        style={{ background: cssVar.colorFillTertiary, borderRadius: cssVar.borderRadius }}
      >
        {icon && (
          <Center flex={'none'} height={28} width={28}>
            {icon}
          </Center>
        )}
        <Input
          defaultValue={initialTitle}
          ref={inputRef}
          size={'small'}
          style={{ flex: 1, minWidth: 0 }}
          // Dark mode defaults to `filled`, which shows no border; the outline
          // carries the focus ring that marks the row as being edited.
          variant={'outlined'}
          onBlur={() => finish(true)}
          onKeyDown={handleKeyDown}
        />
        <ActionIcon
          icon={Sparkles}
          size={'small'}
          title={t('actions.autoRename')}
          onClick={() => {
            if (finishedRef.current) return;
            finishedRef.current = true;
            onClose();
            onAutoRename();
          }}
          // Keep focus in the input, so its blur doesn't save the typed title first.
          onMouseDown={(event) => event.preventDefault()}
        />
      </Flexbox>
    );
  },
);

InlineTitleEditor.displayName = 'InlineTitleEditor';

export default InlineTitleEditor;
