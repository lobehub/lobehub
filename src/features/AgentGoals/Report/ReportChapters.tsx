import type { GoalReportDetourKind } from '@lobechat/types';
import { Flexbox, Markdown, Text } from '@lobehub/ui';
import { memo } from 'react';

import DetourCallout from './DetourCallout';

export interface ReportChapterItem {
  detours: { kind: GoalReportDetourKind; lesson: string; reason: string; title: string }[];
  narrative: string;
  title: string;
}

export interface ReportChaptersProps {
  chapters: ReportChapterItem[];
}

/**
 * The wrap-up report's storyline, chapter by chapter: a title, its narrative as
 * markdown, and the detours it took. Presentation only — it reads no store and
 * links nowhere, so a host with no product behind it can render it as is.
 */
const ReportChapters = memo<ReportChaptersProps>(({ chapters }) => (
  <Flexbox gap={24}>
    {chapters.map((chapter, index) => (
      <Flexbox gap={8} key={index}>
        <Text fontSize={16} weight={600}>
          {chapter.title}
        </Text>
        <Markdown fontSize={14} variant={'chat'}>
          {chapter.narrative}
        </Markdown>
        {chapter.detours.length > 0 && (
          <Flexbox gap={8}>
            {chapter.detours.map((detour, detourIndex) => (
              <DetourCallout key={detourIndex} {...detour} />
            ))}
          </Flexbox>
        )}
      </Flexbox>
    ))}
  </Flexbox>
));

ReportChapters.displayName = 'GoalReportChapters';

export default ReportChapters;
