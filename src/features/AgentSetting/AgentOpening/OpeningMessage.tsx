'use client';

import { Button, Flexbox } from '@lobehub/ui';
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
  const updateConfig = useStore((s) => s.setAgentConfig);
  const setOpeningMessage = useCallback(
    (message: string) => {
      updateConfig({ openingMessage: message });
    },
    [updateConfig],
  );

  const [editing, setEditing] = useState(false);

  const handleEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const editIconButton = !editing && openingMessage && (
    <Button onClick={handleEdit} size={'small'}>
      <PencilLine size={16} />
    </Button>
  );

  return (
    <div className={styles.wrapper}>
      <Flexbox direction={'horizontal'}>
        <EditableMessage
          classNames={{
            markdown: styles.markdown,
          }}
          editButtonSize={'small'}
          editing={editing}
          height={'auto'}
          onChange={setOpeningMessage}
          onEditingChange={setEditing}
          placeholder={t('settingOpening.openingMessage.placeholder')}
          showEditWhenEmpty
          text={{
            cancel: t('cancel', { ns: 'common' }),
            confirm: t('ok', { ns: 'common' }),
          }}
          value={openingMessage ?? ''}
          variant={'borderless'}
        />
        {editIconButton}
      </Flexbox>
    </div>
  );
});

export default OpeningMessage;
