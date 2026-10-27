'use client';

import { agentDisplayName } from '@lobechat/types';
import { Block, Button, Flexbox, Popover, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { DEFAULT_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import type { ProjectComposerAgent } from './projectComposerAgents';

const styles = stylex.create({
  active: {
    backgroundColor: cssVar.colorFillTertiary,
  },
  chevron: {
    flexShrink: 0,
    color: cssVar.colorTextDescription,
  },
  item: {
    cursor: 'pointer',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
  },
  list: {
    overflowY: 'auto',
    maxHeight: '320px',
    padding: '8px',
  },
  name: {
    flex: '1',
    minWidth: 0,
  },
  trigger: {
    maxWidth: '200px',
    paddingInlineStart: '6px',
    paddingInlineEnd: '8px',
  },
});

/** A main agent without a member row (the LobeAI fallback) reads its meta from the agent store. */
const useAgentMeta = (agent: ProjectComposerAgent) => {
  const stored = useAgentStore(agentSelectors.getAgentMetaById(agent.id));
  const { t } = useTranslation('common');
  const source = agent.title || agent.name || agent.avatar ? agent : stored;
  return {
    avatar: (typeof source?.avatar === 'string' ? source.avatar : undefined) || DEFAULT_AVATAR,
    background: source?.backgroundColor || undefined,
    name: agentDisplayName(source, t('defaultAgent')),
  };
};

const AgentRow = memo<{
  active: boolean;
  agent: ProjectComposerAgent;
  onSelect: (id: string) => void;
}>(({ active, agent, onSelect }) => {
  const { t } = useTranslation('project');
  const meta = useAgentMeta(agent);
  return (
    <Block
      clickable
      horizontal
      align={'center'}
      {...stylex.props(styles.item, active && styles.active)}
      gap={8}
      variant={'borderless'}
      onClick={() => onSelect(agent.id)}
    >
      <Avatar
        avatar={meta.avatar}
        background={meta.background}
        name={meta.name}
        shape={'square'}
        size={24}
      />
      <Text
        ellipsis
        type={active ? undefined : 'secondary'}
        weight={active ? 600 : 500}
        {...stylex.props(styles.name)}
      >
        {meta.name}
      </Text>
      {agent.isMain && <Tag size={'small'}>{t('directories.coordinator')}</Tag>}
    </Block>
  );
});

interface ProjectAgentSelectProps {
  agents: ProjectComposerAgent[];
  disabled?: boolean;
  onChange: (agentId: string) => void;
  value: string;
}

/** Picks which project agent the composer sends to; the main agent leads. */
const ProjectAgentSelect = memo<ProjectAgentSelectProps>(
  ({ agents, disabled, onChange, value }) => {
    const { t } = useTranslation('project');
    const [open, setOpen] = useState(false);
    const selected = agents.find((agent) => agent.id === value) ?? agents[0];
    const meta = useAgentMeta(selected);

    return (
      <Popover
        open={open}
        placement={'bottomLeft'}
        styles={{ content: { padding: 0, width: 280 } }}
        trigger={'click'}
        content={
          <Flexbox gap={2} {...stylex.props(styles.list)}>
            {agents.map((agent) => (
              <AgentRow
                active={agent.id === selected.id}
                agent={agent}
                key={agent.id}
                onSelect={(id) => {
                  setOpen(false);
                  onChange(id);
                }}
              />
            ))}
          </Flexbox>
        }
        onOpenChange={(next) => setOpen(disabled ? false : next)}
      >
        <Button
          aria-expanded={open}
          aria-haspopup={'dialog'}
          aria-label={t('overview.agentSelect')}
          {...stylex.props(styles.trigger)}
          disabled={disabled}
          size={'small'}
          type={'text'}
        >
          <Avatar
            avatar={meta.avatar}
            background={meta.background}
            name={meta.name}
            shape={'square'}
            size={18}
          />
          <Text ellipsis fontSize={13} style={{ minWidth: 0 }} weight={500}>
            {meta.name}
          </Text>
          <ChevronDownIcon size={12} {...stylex.props(styles.chevron)} />
        </Button>
      </Popover>
    );
  },
);

ProjectAgentSelect.displayName = 'ProjectAgentSelect';

export default ProjectAgentSelect;
