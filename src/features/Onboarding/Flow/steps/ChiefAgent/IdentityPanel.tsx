'use client';

import { Avatar, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { PencilIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

interface IdentityPanelProps {
  avatar: string;
  handle: string;
  name: string;
  onNameChange: (name: string) => void;
}

const IdentityPanel = memo<IdentityPanelProps>(({ avatar, handle, name, onNameChange }) => {
  const { t, i18n } = useTranslation('onboarding');
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);

  const commitName = useCallback(() => {
    setEditing(false);
    onNameChange(draftName.trim() || name);
  }, [draftName, name, onNameChange]);

  const birthday = new Date().toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.panel}
      gap={20}
      justify={'space-between'}
    >
      <Flexbox flex={1} gap={6}>
        {editing ? (
          <Input
            autoFocus
            className={styles.nameInput}
            placeholder={t('flow.steps.chiefAgent.namePlaceholder')}
            value={draftName}
            variant={'borderless'}
            onBlur={commitName}
            onChange={(e) => setDraftName(e.target.value)}
            onPressEnter={commitName}
          />
        ) : (
          <Flexbox horizontal align={'center'} gap={6}>
            <Text as={'h2'} className={styles.nameText}>
              {name}
            </Text>
            <Icon
              className={styles.nameEditIcon}
              icon={PencilIcon}
              size={14}
              onClick={() => {
                setDraftName(name);
                setEditing(true);
              }}
            />
          </Flexbox>
        )}
        <Text className={styles.infoRow}>
          {'🎂 '}
          {t('flow.steps.chiefAgent.birthday', { date: birthday })}
        </Text>
        <Text className={styles.infoRow}>{`✉️ ${handle}`}</Text>
        <Text className={styles.infoRow}>{`♥ ${t('flow.steps.chiefAgent.mbti')}`}</Text>
      </Flexbox>
      <Avatar avatar={avatar} className={styles.avatarBig} size={96} />
    </Flexbox>
  );
});

IdentityPanel.displayName = 'IdentityPanel';

export default IdentityPanel;
