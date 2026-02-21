'use client';

import { Button, Flexbox, Form } from '@lobehub/ui';
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
  const [systemRole, updateConfig] = useStore((s) => [s.config.systemRole, s.setAgentConfig]);

  const editButton = !editing && !!systemRole && (
    <Button
      icon={PenLineIcon}
      iconPlacement={'end'}
      size={'small'}
      type={'primary'}
      iconProps={{
        size: 12,
      }}
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
                showEditWhenEmpty
                editing={editing}
                height={'auto'}
                placeholder={t('settingAgent.prompt.placeholder')}
                value={systemRole}
                variant={'borderless'}
                markdownProps={{
                  variant: 'chat',
                }}
                text={{
                  cancel: t('cancel', { ns: 'common' }),
                  confirm: t('ok', { ns: 'common' }),
                }}
                onEditingChange={setEditing}
                onChange={(e) => {
                  updateConfig({ systemRole: e });
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
