'use client';

import { Center } from '@lobehub/ui';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { AcceptanceWorkspace } from '@/features/Acceptance';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

const ProjectAcceptance = () => {
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((state) => state.useFetchProjectDetail)(projectId);

  if (detailSWR.error)
    return <AsyncError error={detailSWR.error} variant={'page'} onRetry={detailSWR.mutate} />;
  if (!detail)
    return (
      <Center height={'100%'} width={'100%'}>
        <NeuralNetworkLoading />
      </Center>
    );

  return <AcceptanceWorkspace projectId={detail.project.id} />;
};

export default ProjectAcceptance;
