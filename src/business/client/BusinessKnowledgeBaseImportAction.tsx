import { Button } from '@lobehub/ui';

import { lambdaClient } from '@/libs/trpc/client';

export interface BusinessKnowledgeBaseImportActionProps {
  knowledgeBaseId: string;
}

const BusinessKnowledgeBaseImportAction = ({
  knowledgeBaseId,
}: BusinessKnowledgeBaseImportActionProps) => (
  <Button
    size="small"
    onClick={() =>
      void lambdaClient.knowledgeBase.copyKnowledgeBaseToWorkspace.mutate({
        id: knowledgeBaseId,
        targetWorkspaceId: null,
      })
    }
  >
    Импортировать в личное пространство
  </Button>
);

export default BusinessKnowledgeBaseImportAction;
