import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import BatchIntervention from './BatchIntervention';
import Tool from './Tool';

interface ToolsRendererProps {
  disableEditing?: boolean;
  messageId: string;
  tools: ChatToolPayloadWithResult[];
}

export const Tools = memo<ToolsRendererProps>(({ disableEditing, messageId, tools }) => {
  const { batchGroups, nonBatchTools } = useMemo(() => {
    if (!tools || tools.length === 0) return { batchGroups: [], nonBatchTools: [] };

    const pendingByAuditType = new Map<string, ChatToolPayloadWithResult[]>();
    const others: ChatToolPayloadWithResult[] = [];

    for (const tool of tools) {
      const isPending = tool.intervention?.status === 'pending';
      const auditType = tool.intervention?.auditType;

      if (isPending && auditType) {
        const group = pendingByAuditType.get(auditType) ?? [];
        group.push(tool);
        pendingByAuditType.set(auditType, group);
      } else {
        others.push(tool);
      }
    }

    // Only batch groups with 2+ tools; singles go to nonBatchTools
    const batches: Array<{ auditType: string; tools: ChatToolPayloadWithResult[] }> = [];
    for (const [auditType, groupedTools] of pendingByAuditType) {
      if (groupedTools.length > 1) {
        batches.push({ auditType, tools: groupedTools });
      } else {
        others.push(groupedTools[0]);
      }
    }

    return { batchGroups: batches, nonBatchTools: others };
  }, [tools]);

  if (!tools || tools.length === 0) return null;

  return (
    <Flexbox gap={8}>
      {batchGroups.map(({ auditType, tools: groupedTools }) => (
        <BatchIntervention
          assistantMessageId={messageId}
          auditType={auditType}
          key={`batch-${auditType}`}
          tools={groupedTools}
        />
      ))}
      {nonBatchTools.map((tool) => (
        <Tool
          apiName={tool.apiName}
          arguments={tool.arguments}
          assistantMessageId={messageId}
          disableEditing={disableEditing}
          id={tool.id}
          identifier={tool.identifier}
          intervention={tool.intervention}
          key={tool.id}
          result={tool.result}
          toolMessageId={tool.result_msg_id}
          type={tool.type}
        />
      ))}
    </Flexbox>
  );
});
