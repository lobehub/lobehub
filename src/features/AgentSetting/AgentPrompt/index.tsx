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
      iconProps={{
        size: 12,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      size={'small'}
      type={'primary'}
    >
      {t('edit', { ns: 'common' })}
    </Button>
  );

  return (
    <Form
      items={[
        {
          children: (
            <Flexbox paddingBlock={isMobile ? 16 : 0}>
              <EditableMessage
                editing={editing}
                height={'auto'}
                markdownProps={{
                  variant: 'chat',
                }}
                onChange={(e) => {
                  updateConfig({ systemRole: e });
                }}
                onEditingChange={setEditing}
                placeholder={t('settingAgent.prompt.placeholder')}
                showEditWhenEmpty
                text={{
                  cancel: t('cancel', { ns: 'common' }),
                  confirm: t('ok', { ns: 'common' }),
                }}
                value={systemRole}
                variant={'borderless'}
              />
              {!editing && !!systemRole && <Tokens value={systemRole} />}
            </Flexbox>
          ),
          extra: editButton,
          title: t('settingAgent.prompt.title'),
        },
      ]}
      itemsType={'group'}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default AgentPrompt;
