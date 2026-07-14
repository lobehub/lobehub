'use client';

import { Flexbox, Form, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { EditableMessage } from '@lobehub/ui/chat';
import { PenLineIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import Tokens from '@/features/AgentSetting/AgentPrompt/TokenTag';
import { useServerConfigStore } from '@/store/serverConfig';

import { useStore } from '../store';

const AgentPrompt = memo(() => {
  const { t } = useTranslation('setting');
  const isMobile = useServerConfigStore((s) => s.isMobile);
  const [editing, setEditing] = useState(false);
  const [systemRole, disabled, updateConfig] = useStore((s) => [
    s.config.systemRole,
    s.disabled,
    s.setAgentConfig,
  ]);

  const editButton = !editing && !!systemRole && !disabled && (
    <Button
      icon={<Icon icon={PenLineIcon} size={12} />}
      iconPosition={'end'}
      size={'small'}
      type={'primary'}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {t('edit', { ns: 'common' })}
    </Button>
  );

  return (
    <Form
      itemsType={'group'}
      variant={'borderless'}
      items={[
        {
          children: (
            <Flexbox paddingBlock={isMobile ? 16 : 0}>
              <EditableMessage
                editing={editing}
                height={'auto'}
                placeholder={t('settingAgent.prompt.placeholder')}
                showEditWhenEmpty={!disabled}
                value={systemRole}
                variant={'borderless'}
                markdownProps={{
                  variant: 'chat',
                }}
                text={{
                  cancel: t('cancel', { ns: 'common' }),
                  confirm: t('ok', { ns: 'common' }),
                }}
                onChange={(e) => {
                  if (disabled) return;

                  updateConfig({ systemRole: e });
                }}
                onEditingChange={(next) => {
                  if (disabled) return;

                  setEditing(next);
                }}
              />
              {!editing && !!systemRole && <Tokens value={systemRole} />}
            </Flexbox>
          ),
          extra: editButton,
          title: t('settingAgent.prompt.title'),
        },
      ]}
      {...FORM_STYLE}
    />
  );
});

export default AgentPrompt;
