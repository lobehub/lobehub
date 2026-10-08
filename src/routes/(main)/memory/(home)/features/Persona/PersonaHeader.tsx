import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserMemoryStore } from '@/store/userMemory';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 28px;
    font-weight: 700;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

const PersonaHeader = () => {
  const { t } = useTranslation(['memory', 'common']);
  const deletePersona = useUserMemoryStore((s) => s.deletePersona);
  const [loading, setLoading] = useState(false);

  const confirmDelete = () =>
    confirmModal({
      title: t('persona.delete.title'),
      content: t('persona.delete.confirm'),
      cancelText: t('cancel', { ns: 'common' }),
      okText: t('delete', { ns: 'common' }),
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        try {
          await deletePersona();
          toast.success(t('persona.delete.success'));
        } catch (error) {
          toast.error(t('persona.delete.error'));
          throw error;
        } finally {
          setLoading(false);
        }
      },
    });

  return (
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      <Text as={'h1'} className={styles.title}>
        Persona
      </Text>
      <Button danger loading={loading} size={'small'} onClick={confirmDelete}>
        {t('persona.delete.action')}
      </Button>
    </Flexbox>
  );
};

export default PersonaHeader;
