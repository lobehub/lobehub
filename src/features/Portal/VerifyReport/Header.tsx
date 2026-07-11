import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { Maximize2 } from 'lucide-react';
import { memo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import Header from '../components/Header';
import Title from './Title';

const VerifyReportHeader = memo(() => {
  const navigate = useWorkspaceAwareNavigate();
  const runId = useChatStore(chatPortalSelectors.verifyReportRunId);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  return (
    <Header
      title={<Title />}
      rightExtra={
        <ActionIcon
          disabled={!runId}
          icon={Maximize2}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          onClick={() => {
            if (!runId) return;
            navigate(`/verify/${runId}`);
            clearPortalStack();
          }}
        />
      }
    />
  );
});

export default VerifyReportHeader;
