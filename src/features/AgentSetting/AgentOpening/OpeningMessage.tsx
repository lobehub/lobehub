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
    <Button size={'small'} onClick={handleEdit}>
      <PencilLine size={16} />
    </Button>
  );

  return (
    <div className={styles.wrapper}>
      <Flexbox direction={'horizontal'}>
        <EditableMessage
          showEditWhenEmpty
          editButtonSize={'small'}
          editing={editing}
          height={'auto'}
          placeholder={t('settingOpening.openingMessage.placeholder')}
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
          onEditingChange={setEditing}
        />
        {editIconButton}
      </Flexbox>
    </div>
  );
});

export default OpeningMessage;
