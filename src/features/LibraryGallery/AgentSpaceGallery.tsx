'use client';

import { Empty, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { BotIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AsyncBoundary from '@/components/AsyncBoundary';
import {
  RESOURCE_HOME_SECTIONS,
  ResourceSectionSkeleton,
} from '@/components/Skeleton/ResourceHome';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

import { libraryCardStyles } from './LibraryCard';

interface AgentSpaceGalleryProps {
  onOpen: (id: string) => void;
}

/** Every agent's dedicated library, identified by the agent rather than a cover. */
const AgentSpaceGallery = ({ onOpen }: AgentSpaceGalleryProps) => {
  const { t } = useTranslation('file');
  const useFetchAgentSpaceList = useKnowledgeBaseStore((s) => s.useFetchAgentSpaceList);
  const { error, isHydrated, revalidate } = useFetchAgentSpaceList(true);
  const data = useKnowledgeBaseStore(knowledgeBaseSelectors.agentSpaceList);

  return (
    <AsyncBoundary
      data={data}
      error={error}
      isEmpty={data?.length === 0}
      isLoading={!data && (!isHydrated || !error)}
      loading={<ResourceSectionSkeleton {...RESOURCE_HOME_SECTIONS.libraries} />}
      empty={
        <Empty
          description={t('docs.library.agentSpaces.emptyDesc')}
          icon={BotIcon}
          title={t('docs.library.agentSpaces.emptyTitle')}
        />
      }
      onRetry={() => revalidate()}
    >
      <div {...stylex.props(libraryCardStyles.grid)}>
        {data?.map((space) => {
          const name = space.title || t('docs.library.agentSpaces.untitled');

          return (
            <button
              key={space.id}
              type={'button'}
              {...stylex.props(libraryCardStyles.card)}
              onClick={() => onOpen(space.id)}
            >
              <Flexbox gap={10} padding={14} width={'100%'}>
                <AgentAvatar
                  agentId={space.agentId}
                  avatar={space.avatar}
                  background={space.backgroundColor ?? undefined}
                  name={name}
                  size={40}
                />
                <span {...stylex.props(libraryCardStyles.name)}>{name}</span>
                <div {...stylex.props(libraryCardStyles.description)}>
                  {space.description || t('docs.library.noDescription')}
                </div>
              </Flexbox>
            </button>
          );
        })}
      </div>
    </AsyncBoundary>
  );
};

export default AgentSpaceGallery;
