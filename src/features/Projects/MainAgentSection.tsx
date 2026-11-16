import { createProjectCoordinatorAgentConfig } from '@lobechat/builtin-agents';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

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
  /** Id reserved for the dedicated agent: seeds the character it keeps after creation. */
  dedicatedAgentId: string;
  /** The project's avatar and name, which a dedicated agent takes over. */
  projectAvatar?: string;
  projectName: string;
}

/**
 * Every project is led by an agent created for it. The agent does not exist
 * until the project is created, so this row previews the one the server will
 * create.
 */
const MainAgentSection = memo<MainAgentSectionProps>(
  ({ dedicatedAgentId, projectAvatar, projectName }) => {
    const { t } = useTranslation('project');
    const name = projectName.trim();
    const dedicatedTitle = name ? createProjectCoordinatorAgentConfig({ name }).title : undefined;

    return (
      <Flexbox gap={6}>
        <Text fontSize={13} weight={500}>
          {t('create.mainAgentLabel')}
        </Text>
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
        <Text fontSize={12} type="secondary">
          {t('create.mainAgentDedicatedDescription')}
        </Text>
      </Flexbox>
    );
  },
);

MainAgentSection.displayName = 'MainAgentSection';

export default MainAgentSection;
