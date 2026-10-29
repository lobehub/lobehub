import { agentDisplayName } from '@lobechat/types';
import { Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AssigneeAgentSelector from '@/features/AgentTasks/features/AssigneeAgentSelector';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

const styles = stylex.create({
  trigger: {
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    width: '100%',
    height: 36,
    paddingInlineStart: '8px',
    paddingInlineEnd: '10px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorPrimaryHover },
    borderRadius: cssVar.borderRadius,
  },
});

interface MainAgentFieldProps {
  agentId?: string;
  disabled?: boolean;
  onChange: (agentId: string) => void;
}

const MainAgentField = memo<MainAgentFieldProps>(({ agentId, disabled, onChange }) => {
  const { t } = useTranslation(['project', 'chat']);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const listed = useHomeStore((s) =>
    agentId ? homeAgentListSelectors.getAgentById(agentId)(s) : undefined,
  );
  const inboxMeta = useAgentStore((s) =>
    agentId && agentId === inboxAgentId ? agentSelectors.getAgentMetaById(agentId)(s) : undefined,
  );
  const isInbox = !!agentId && agentId === inboxAgentId;
  const name =
    agentDisplayName(listed) ??
    agentDisplayName(inboxMeta) ??
    (isInbox ? t('inbox.title', { ns: 'chat' }) : undefined);
  const avatar = typeof listed?.avatar === 'string' ? listed.avatar : inboxMeta?.avatar;

  return (
    <AssigneeAgentSelector
      block
      allowUnassigned={false}
      currentAgentId={agentId}
      disabled={disabled}
      taskVisibility="public"
      onChange={(id) => id && onChange(id)}
    >
      <div {...stylex.props(styles.trigger)}>
        <AgentAvatar
          agentId={agentId}
          avatar={avatar ?? undefined}
          name={name}
          size={22}
          title={name}
        />
        <Text ellipsis style={{ flex: 1 }}>
          {name ?? t('create.mainAgentPlaceholder')}
        </Text>
        <Icon icon={ChevronDownIcon} size={14} />
      </div>
    </AssigneeAgentSelector>
  );
});

MainAgentField.displayName = 'MainAgentField';

export default MainAgentField;
