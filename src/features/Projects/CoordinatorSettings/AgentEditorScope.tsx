import { type FC, lazy, type PropsWithChildren, Suspense, useLayoutEffect } from 'react';

import ProfileSkeleton from '@/components/Skeleton/Profile';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import EditLockDriver from '@/routes/(main)/agent/profile/features/EditLockDriver';
import ProfileHydration from '@/routes/(main)/agent/profile/features/ProfileHydration';
import ProfileProvider from '@/routes/(main)/agent/profile/features/ProfileProvider';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import type { CoordinatorSettingsView } from './views';

const EnvironmentEditor = lazy(
  () => import('@/routes/(main)/agent/profile/features/EnvironmentEditor'),
);
const KnowledgeEditor = lazy(
  () => import('@/routes/(main)/agent/profile/features/KnowledgeEditor'),
);
const SkillsEditor = lazy(() => import('@/routes/(main)/agent/profile/features/SkillsEditor'));
const ToolsEditor = lazy(() => import('@/routes/(main)/agent/profile/features/ToolsEditor'));

export type EmbeddedEditorView = Extract<
  CoordinatorSettingsView,
  'environment' | 'knowledge' | 'skills' | 'tools'
>;

const EDITORS: Record<EmbeddedEditorView, FC> = {
  environment: EnvironmentEditor,
  knowledge: KnowledgeEditor,
  skills: SkillsEditor,
  tools: ToolsEditor,
};

/**
 * Points the agent store at the coordinator while the project settings show
 * one of its editors, and loads its config — the same binding `/agent/:aid`
 * gives those editors, without the conversation's topic switching. The previous
 * binding is restored on unmount so a project conversation underneath is not
 * left pointing at the coordinator.
 */
export const CoordinatorAgentBinding = ({
  agentId,
  children,
}: PropsWithChildren<{ agentId: string }>) => {
  useInitAgentConfig(agentId);

  useLayoutEffect(() => {
    const previous = useAgentStore.getState().activeAgentId;
    useAgentStore.setState({ activeAgentId: agentId }, false, 'ProjectCoordinator/bindAgent');
    return () => {
      useAgentStore.setState({ activeAgentId: previous }, false, 'ProjectCoordinator/unbindAgent');
    };
  }, [agentId]);

  const bound = useAgentStore((s) => s.activeAgentId === agentId);
  return bound ? children : null;
};

const EditorBody = ({ view }: { view: EmbeddedEditorView }) => {
  const isLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const Editor = EDITORS[view];
  if (isLoading) return <ProfileSkeleton />;
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <Editor />
    </Suspense>
  );
};

/**
 * The agent's own tools, skills, knowledge and environment editors, embedded
 * for the project's coordinator. They write the agent row the project
 * resolves — the same row `project.updateCoordinatorConfig` writes — so the
 * project settings stay the single place to configure it.
 */
export const CoordinatorAgentEditor = ({
  agentId,
  view,
}: {
  agentId: string;
  view: EmbeddedEditorView;
}) => (
  <CoordinatorAgentBinding agentId={agentId}>
    <ProfileProvider>
      <EditorBody view={view} />
      <EditLockDriver />
      <Suspense fallback={null}>
        <ProfileHydration />
      </Suspense>
    </ProfileProvider>
  </CoordinatorAgentBinding>
);
