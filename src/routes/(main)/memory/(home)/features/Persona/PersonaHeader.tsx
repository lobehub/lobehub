import { Button, confirmModal, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserMemoryStore } from '@/store/userMemory';

const styles = stylex.create({
  title: { fontSize: '28px', fontWeight: 700, lineHeight: 1.4, color: cssVar.colorText },
});

const PersonaHeader = () => {
  const { t } = useTranslation(['memory', 'common']);
  const workspaceId = useActiveWorkspaceId();
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
      <Text as={'h1'} className={stylex.props(styles.title).className}>
        Persona
      </Text>
      {!workspaceId && (
        <Button danger loading={loading} size={'small'} onClick={confirmDelete}>
          {t('persona.delete.action')}
        </Button>
      )}
    </Flexbox>
  );
};

export default PersonaHeader;
