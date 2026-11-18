'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilLine } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStore } from '../store';
import { selectors } from '../store/selectors';

const styles = stylex.create({
  markdown: {
    borderWidth: 'unset',
    borderStyle: 'unset',
    borderColor: 'unset',
  },
  wrapper: {
    width: '100%',
    padding: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: `calc(${cssVar.borderRadiusLG} - 1px)`,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const OpeningMessage = memo(() => {
  const { t } = useTranslation('setting');

  const openingMessage = useStore(selectors.openingMessage);
  const [disabled, updateConfig] = useStore((s) => [s.disabled, s.setAgentConfig]);
  const setOpeningMessage = useCallback(
    (message: string) => {
      if (disabled) return;

      updateConfig({ openingMessage: message });
    },
    [disabled, updateConfig],
  );

  const [editing, setEditing] = useState(false);

  const handleEdit = useCallback(() => {
    if (disabled) return;

    setEditing(true);
  }, [disabled]);

  const editIconButton = !editing && openingMessage && !disabled && (
    <Button disabled={disabled} size={'small'} onClick={handleEdit}>
      <PencilLine size={16} />
    </Button>
  );

  return (
    <div {...stylex.props(styles.wrapper)}>
      <Flexbox direction={'horizontal'}>
        <EditableMessage
          editButtonSize={'small'}
          editing={editing}
          height={'auto'}
          placeholder={t('settingOpening.openingMessage.placeholder')}
          showEditWhenEmpty={!disabled}
          value={openingMessage ?? ''}
          variant={'borderless'}
          classNames={{
            markdown: stylex.props(styles.markdown).className,
          }}
          text={{
            cancel: t('cancel', { ns: 'common' }),
            confirm: t('ok', { ns: 'common' }),
          }}
          onChange={setOpeningMessage}
          onEditingChange={(next) => {
            if (disabled) return;

            setEditing(next);
          }}
        />
        {editIconButton}
      </Flexbox>
    </div>
  );
});

export default OpeningMessage;
