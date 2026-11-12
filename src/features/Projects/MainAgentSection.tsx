import { createProjectCoordinatorAgentConfig } from '@lobechat/builtin-agents';
import { Flexbox, Segmented, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

import type { MainAgentMode } from './createProjectForm';
import MainAgentField from './MainAgentField';

const styles = stylex.create({
  preview: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    height: 36,
    paddingInline: '8px',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadius,
  },
});

interface MainAgentSectionProps {
  agentId?: string;
  /** Id reserved for the dedicated agent: seeds the character it keeps after creation. */
  dedicatedAgentId: string;
  disabled?: boolean;
  mode: MainAgentMode;
  onAgentChange: (agentId: string) => void;
  onModeChange: (mode: MainAgentMode) => void;
  /** The project's avatar and name, which a dedicated agent takes over. */
  projectAvatar?: string;
  projectName: string;
}

/**
 * Lead the project with an agent created for it, or pick one the workspace
 * already has. The dedicated agent does not exist until the project is
 * created, so its row previews the agent the server will create.
 */
const MainAgentSection = memo<MainAgentSectionProps>(
  ({
    agentId,
    dedicatedAgentId,
    disabled,
    mode,
    onAgentChange,
    onModeChange,
    projectAvatar,
    projectName,
  }) => {
    const { t } = useTranslation('project');
    const name = projectName.trim();
    const dedicatedTitle = name ? createProjectCoordinatorAgentConfig({ name }).title : undefined;

    return (
      <Flexbox gap={6}>
        <Text fontSize={13} weight={500}>
          {t('create.mainAgentLabel')}
        </Text>
        <Segmented
          block
          disabled={disabled}
          value={mode}
          options={[
            { label: t('create.mainAgentMode.dedicated'), value: 'dedicated' },
            { label: t('create.mainAgentMode.existing'), value: 'existing' },
          ]}
          onChange={(value) => onModeChange(value as MainAgentMode)}
        />
        {mode === 'dedicated' ? (
          <div {...stylex.props(styles.preview)}>
            {/* Without a project avatar the agent draws the generated character
                its reserved id seeds, the one it keeps after creation. */}
            <AgentAvatar
              agentId={dedicatedAgentId}
              avatar={projectAvatar}
              name={dedicatedTitle}
              size={22}
              title={dedicatedTitle}
            />
            <Text ellipsis style={{ flex: 1 }} type={dedicatedTitle ? undefined : 'secondary'}>
              {dedicatedTitle ?? t('create.mainAgentDedicatedPlaceholder')}
            </Text>
            <Tag size={'small'}>{t('create.mainAgentDedicatedTag')}</Tag>
          </div>
        ) : (
          <MainAgentField agentId={agentId} disabled={disabled} onChange={onAgentChange} />
        )}
        <Text fontSize={12} type="secondary">
          {t(
            mode === 'dedicated'
              ? 'create.mainAgentDedicatedDescription'
              : 'create.mainAgentDescription',
          )}
        </Text>
      </Flexbox>
    );
  },
);

MainAgentSection.displayName = 'MainAgentSection';

export default MainAgentSection;
