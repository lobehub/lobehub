'use client';

import { Center, Spin, Text } from '@lobehub/ui';
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams, useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectTopics,
} from '@/store/projectWorkingDirectory';

import { getProjectTopicPath } from '../Layout/navigation';
import { freshProjectTopicAgentId } from './freshProjectTopicAgentId';
import { projectConversationStage } from './projectConversationStage';
import { useMarkProjectTopicRead } from './useMarkProjectTopicRead';
import { useProjectDraftStaging } from './useProjectDraftStaging';
import { useRevalidateWhileUnlisted } from './useRevalidateWhileUnlisted';

const loading = (
  <Center height="100%" width="100%">
    <Spin size="small" />
  </Center>
);

/**
 * Route, store and agent wiring for a project conversation, shared by the
 * desktop workspace and the mobile page. `fallback` is set until the pane can
 * render at all (error, redirect, not-found or loading).
 */
export const useProjectConversation = () => {
  const { t } = useTranslation('project');
  const { projectId, topicId } = useParams<{ projectId: string; topicId?: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const topicsRequest = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(
    detail?.project.id,
  );
  const topics = useProjectTopics(detail?.project.id);
  const selectedTopic = topics.find((topic) => topic.id === topicId);
  const projectSlug = detail?.project.slug ?? projectId;
  const storedTopic = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s) : undefined,
  );
  // A sidebar "+" opens a blank draft instead of creating a row (see
  // `startProjectTopicDraft`). The draft rides in this pane's route, so split
  // panes keep their own; the first message creates the topic.
  const [searchParams] = useSearchParams();
  const draftAgentParam = topicId ? null : searchParams.get('agent');
  const draftDirectoryParam = topicId ? null : searchParams.get('dir');
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(
    detail?.project.id,
  );
  const directories = useProjectDirectories(detail?.project.id);
  const directoryIds = useMemo(() => new Set(directories.map((d) => d.id)), [directories]);
  const draft = useMemo(
    () =>
      draftAgentParam && draftDirectoryParam && directoryIds.has(draftDirectoryParam)
        ? { agentId: draftAgentParam, projectWorkingDirectoryId: draftDirectoryParam }
        : undefined,
    [draftAgentParam, draftDirectoryParam, directoryIds],
  );
  const draftAgentId = draft?.agentId;
  const restageDraft = useProjectDraftStaging(draft, directoryIds);
  const chatAgentId = useChatStore((s) => s.activeAgentId);
  // Keep the conversation on its agent instead of flashing "not found" while
  // the project list catches up with a topic the first send just created.
  const freshOwnerRef = useRef<{ agentId: string; topicId: string }>(undefined);
  const freshTopicAgentId = freshProjectTopicAgentId({
    listed: !!selectedTopic,
    projectId: detail?.project.id,
    rememberedOwner: freshOwnerRef.current,
    storedTopic,
    topicId,
  });
  useEffect(() => {
    if (freshTopicAgentId && topicId)
      freshOwnerRef.current = { agentId: freshTopicAgentId, topicId };
  }, [freshTopicAgentId, topicId]);
  const isFreshTopic = !!freshTopicAgentId;
  const conversationAgentId = topicId
    ? (selectedTopic?.agentId ?? freshTopicAgentId)
    : draftAgentId;
  useRevalidateWhileUnlisted(isFreshTopic, topicId, topicsRequest.revalidate);
  const topicTitle = storedTopic?.title;

  const agent = useInitAgentConfig(conversationAgentId);
  const topicDetail = useChatStore((s) => s.useFetchTopicDetail)(selectedTopic?.id);
  useMarkProjectTopicRead(detail?.project.id, selectedTopic);

  useLayoutEffect(() => {
    if (!conversationAgentId) return;

    useAgentStore.setState(
      { activeAgentId: conversationAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
    useChatStore.setState(
      { activeAgentId: conversationAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
  }, [conversationAgentId]);

  const getConversationPath = useCallback(() => getProjectTopicPath(projectSlug!), [projectSlug]);
  const getTopicPath = useCallback(
    (_agentId: string, topicId: string) => getProjectTopicPath(projectSlug!, topicId),
    [projectSlug],
  );
  const stage = projectConversationStage({
    agentConfigLoading: !!agent.isLoading,
    chatAgentId,
    conversationAgentId,
    hasProject: !!detail,
  });

  let fallback: ReactElement | undefined;
  if (topicDetail.error)
    fallback = (
      <AsyncError error={topicDetail.error} variant="page" onRetry={topicDetail.revalidate} />
    );
  else if (agent.error)
    fallback = <AsyncError error={agent.error} variant="page" onRetry={agent.mutate} />;
  else if (topicsRequest.error)
    fallback = (
      <AsyncError error={topicsRequest.error} variant="page" onRetry={topicsRequest.revalidate} />
    );
  else if (!topicId && !draftAgentId) {
    // A draft's directory list may still be loading; wait for it rather than
    // sending the draft away. Other new project conversations start from the
    // project home composer.
    fallback =
      draftAgentParam && !directoriesRequest.hasData ? (
        loading
      ) : (
        <Navigate replace relative="path" to=".." />
      );
  } else if (topicId && topicsRequest.hasData && !selectedTopic && !isFreshTopic)
    fallback = (
      <Center height="100%">
        <Text>{t('topics.notFound')}</Text>
      </Center>
    );
  else if (detailSWR.error && !detail)
    fallback = <AsyncError error={detailSWR.error} variant="page" onRetry={detailSWR.revalidate} />;
  else if (stage === 'loading') fallback = loading;

  return {
    fallback,
    getConversationPath,
    getTopicPath,
    restageDraft,
    /** `agentPending` keeps the header mounted while only the conversation waits. */
    stage,
    title: topicTitle || selectedTopic?.title || t('sidebar.newConversation'),
    topic: topicId
      ? {
          id: topicId,
          status: selectedTopic?.status,
          title: topicTitle || selectedTopic?.title || t('directories.untitled'),
        }
      : undefined,
  };
};
