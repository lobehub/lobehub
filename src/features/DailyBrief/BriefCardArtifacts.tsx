import type { BriefArtifactDocument, BriefArtifacts } from '@lobechat/types';
import { Block, createStaticStyles, cssVar, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { ChevronRightIcon, FileTextIcon, type LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { openAgentSkillModal, preloadAgentSkillModal } from '@/features/AgentSkillModal/loader';
import { useAgentSkill } from '@/features/AgentSkillModal/useAgentSkill';
import { openDocumentModal, preloadDocumentModal } from '@/features/DocumentModal/loader';

import { resolveBriefArtifactTarget } from './briefArtifactTarget';

const styles = createStaticStyles(({ css, cssVar }) => ({
  iconWrap: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface BriefArtifactCardProps {
  /** A second line under the title, e.g. what a skill is for. */
  description?: ReactNode;
  icon: LucideIcon;
  onOpen: () => void;
  onPreload: () => void;
  title: string;
}

const BriefArtifactCard = ({
  description,
  icon,
  onOpen,
  onPreload,
  title,
}: BriefArtifactCardProps) => (
  <Block
    clickable
    horizontal
    align={'center'}
    gap={12}
    paddingBlock={10}
    paddingInline={12}
    variant={'filled'}
    onClick={onOpen}
    onFocus={onPreload}
    onPointerEnter={onPreload}
  >
    <div className={styles.iconWrap}>
      <Icon color={cssVar.colorTextSecondary} icon={icon} size={{ size: 20, strokeWidth: 1.5 }} />
    </div>
    <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
      <Text ellipsis weight={500}>
        {title}
      </Text>
      {description}
    </Flexbox>
    <Icon
      color={cssVar.colorTextQuaternary}
      icon={ChevronRightIcon}
      size={16}
      style={{ flexShrink: 0 }}
    />
  </Block>
);

const SKILL_ICON = SkillsIcon as unknown as LucideIcon;

/**
 * A skill reads as its title and what it is for. The description comes from
 * the skill itself, through the same request the skill modal makes, so opening
 * it right after shows the skill at once.
 */
const SkillArtifactCard = ({
  agentDocumentId,
  agentId,
  title,
}: {
  agentDocumentId: string;
  agentId: string;
  title: string | null;
}) => {
  const { data: skill, isLoading } = useAgentSkill(agentId, agentDocumentId);

  return (
    <BriefArtifactCard
      icon={SKILL_ICON}
      title={skill?.title || title || 'Untitled'}
      description={
        isLoading ? (
          <Skeleton.Text fontSize={12} rows={1} width={240} />
        ) : (
          skill?.description && (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {skill.description}
            </Text>
          )
        )
      }
      onOpen={() => void openAgentSkillModal({ agentDocumentId, agentId, title })}
      onPreload={preloadAgentSkillModal}
    />
  );
};

const BriefArtifact = ({
  agentId,
  doc,
}: {
  agentId?: string | null;
  doc: BriefArtifactDocument;
}) => {
  const target = resolveBriefArtifactTarget(doc, agentId);
  if (!target) return null;

  const title = doc.title || 'Untitled';

  if (target.type === 'skill') {
    return (
      <SkillArtifactCard
        agentDocumentId={target.agentDocumentId}
        agentId={target.agentId}
        title={doc.title}
      />
    );
  }

  return (
    <BriefArtifactCard
      icon={FileTextIcon}
      title={title}
      onOpen={() => void openDocumentModal(target.documentId)}
      onPreload={preloadDocumentModal}
    />
  );
};

interface BriefCardArtifactsProps {
  /** The agent the brief is about; a skill artifact is one of its skills. */
  agentId?: string | null;
  artifacts?: BriefArtifacts | null;
}

const BriefCardArtifacts = memo<BriefCardArtifactsProps>(({ agentId, artifacts }) => {
  const docs = artifacts?.documents;
  if (!docs?.length) return null;

  return (
    <Flexbox gap={8}>
      {docs.map((doc) => (
        <BriefArtifact agentId={agentId} doc={doc} key={doc.id} />
      ))}
    </Flexbox>
  );
});

export default BriefCardArtifacts;
