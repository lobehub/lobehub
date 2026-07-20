'use client';

import { Avatar, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { CalendarIcon, HeartIcon, MailIcon, PencilIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BackButton from '../../BackButton';
import { findChiefAgentPresetByAvatar } from './avatars';
import { styles } from './style';

interface IdentityPanelProps {
  avatar: string;
  handle: string;
  name: string;
  onBack?: () => void;
  onNameChange: (name: string) => void;
}

const IdentityPanel = memo<IdentityPanelProps>(({ avatar, handle, name, onBack, onNameChange }) => {
  const { t, i18n } = useTranslation('onboarding');
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);

  const commitName = useCallback(() => {
    setEditing(false);
    onNameChange(draftName.trim() || name);
  }, [draftName, name, onNameChange]);

  const preset = findChiefAgentPresetByAvatar(avatar);

  const birthday = new Date().toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const infoRows = [
    { icon: CalendarIcon, label: t('flow.steps.chiefAgent.birthday', { date: birthday }) },
    { icon: MailIcon, label: handle },
    { icon: HeartIcon, label: t('flow.steps.chiefAgent.mbti') },
  ];

  return (
    <div
      className={styles.panel}
      style={
        preset
          ? { background: `linear-gradient(135deg, ${preset.tint}24, ${preset.tint}0f)` }
          : undefined
      }
    >
      {onBack && <BackButton onClick={onBack} />}
      <Flexbox className={styles.identity} gap={10}>
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
          <Flexbox horizontal align={'center'} className={styles.nameRow} gap={8}>
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
        <Flexbox gap={6}>
          {infoRows.map(({ icon, label }) => (
            <Flexbox horizontal align={'center'} gap={8} key={label}>
              <Icon className={styles.infoIcon} icon={icon} size={13} />
              <Text className={styles.infoRow}>{label}</Text>
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
      {preset ? (
        <img alt={''} className={styles.hero} src={preset.hero} />
      ) : (
        <Avatar avatar={avatar} className={styles.avatarBig} size={96} />
      )}
    </div>
  );
});

IdentityPanel.displayName = 'IdentityPanel';

export default IdentityPanel;
