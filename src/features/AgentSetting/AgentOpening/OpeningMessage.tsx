'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { createStaticStyles } from 'antd-style';
import { PencilLine } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStore } from '../store';
import { selectors } from '../store/selectors';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  markdown: css`
    border: unset;
  `,
  wrapper: css`
    width: 100%;
    padding: 8px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: calc(${cssVar.borderRadiusLG} - 1px);

    background: ${cssVar.colorBgContainer};
  `,
}));

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
    <div className={styles.wrapper}>
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
            markdown: styles.markdown,
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
