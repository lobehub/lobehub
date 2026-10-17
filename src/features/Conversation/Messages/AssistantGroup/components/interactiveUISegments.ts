import { LOADING_FLAT } from '@/const/message';

import { isInteractiveUITool } from '../toolRenderRules';
import type { GroupRenderSegment } from './segments';
import type { RenderableAssistantContentBlock } from './types';

const hasProcessContent = (block: RenderableAssistantContentBlock): boolean =>
  (!!block.content && block.content !== LOADING_FLAT) ||
  !!block.reasoning ||
  !!block.imageList?.length ||
  !!block.council?.length ||
  !!block.error ||
  !!block.metadata?.finishType;

/**
 * Isolate renderUI calls even when the semantic partitioner inlines a lone tool
 * or projects an errored step. Only the tool is a deliverable: its source step's
 * narration, reasoning and neighbouring tools still belong to the process.
 *
 * Keys depend on the persisted call id, never the result or segment position, so
 * later parallel calls, answers and folding cannot restart the embedded app.
 */
export const preserveInteractiveUIDeliverables = (
  segments: GroupRenderSegment[],
): GroupRenderSegment[] =>
  segments.flatMap((segment) => {
    if (
      segment.kind !== 'workflow' ||
      !segment.blocks.some((block) => block.tools?.some(isInteractiveUITool))
    ) {
      return [segment];
    }

    const result: GroupRenderSegment[] = [];
    let processBlocks: RenderableAssistantContentBlock[] = [];
    const flushProcess = () => {
      if (!processBlocks.length) return;
      result.push({
        ...segment,
        blocks: processBlocks,
        // A narration-only prefix has no tool workflow to summarize. Keep it
        // inline while generating; the outer process fold still owns it later.
        standalone: segment.standalone || processBlocks.every((block) => !block.tools?.length),
      });
      processBlocks = [];
    };

    for (const block of segment.blocks) {
      if (!block.tools?.some(isInteractiveUITool)) {
        processBlocks.push(block);
        continue;
      }

      let ownsContent = true;
      let processTools: NonNullable<RenderableAssistantContentBlock['tools']> = [];
      const flushProcessTools = () => {
        if (!processTools.length && !(ownsContent && hasProcessContent(block))) return;

        const key = `${block.id}__process__${processTools[0]?.id ?? 'content'}`;
        processBlocks.push({
          ...block,
          content: ownsContent ? block.content : '',
          contentOverride: ownsContent ? (block.contentOverride ?? block.content) : '',
          council: ownsContent ? block.council : undefined,
          domId: key,
          error: ownsContent ? block.error : undefined,
          hasToolsOverride: !!processTools.length,
          imageList: ownsContent ? block.imageList : undefined,
          metadata: ownsContent ? block.metadata : undefined,
          projection: 'workflow',
          projectionKey: key,
          reasoning: ownsContent ? block.reasoning : undefined,
          renderKey: key,
          tools: processTools,
        });
        ownsContent = false;
        processTools = [];
      };

      for (const tool of block.tools) {
        if (!isInteractiveUITool(tool)) {
          processTools.push(tool);
          continue;
        }

        flushProcessTools();
        flushProcess();
        const key = `${block.id}__interactive-ui__${tool.id}`;
        result.push({
          blocks: [
            {
              content: '',
              contentOverride: '',
              domId: key,
              hasToolsOverride: true,
              id: block.id,
              projection: 'workflow',
              projectionKey: key,
              renderKey: key,
              tools: [tool],
            },
          ],
          kind: 'workflow',
          preserveOutsideProcessFold: true,
          standalone: true,
        });
      }
      flushProcessTools();
    }

    flushProcess();
    return result;
  });
