import type { MeetingDetail, meetingService } from '@/services/meeting';

type Minutes = NonNullable<MeetingDetail['minutes']>;
type CreateTasksResult = Awaited<ReturnType<typeof meetingService.createTasks>>;

/** The minutes' lists, each empty when the payload omits it. */
export const minutesLists = (minutes: Partial<Minutes>) => ({
  actionItems: minutes.actionItems ?? [],
  chapters: minutes.chapters ?? [],
  decisions: minutes.decisions ?? [],
  keywords: minutes.keywords ?? [],
});

/** How many action items became tasks and how many failed, zero for an omitted list. */
export const taskCreationCounts = (result?: Partial<CreateTasksResult>) => ({
  created: result?.created?.length ?? 0,
  failed: result?.failed?.length ?? 0,
});

const NO_SEGMENTS: MeetingDetail['segments'] = [];
const NO_SPEAKERS: MeetingDetail['speakers'] = [];

/** The transcript lists, falling back to shared empty arrays so memo deps stay stable. */
export const transcriptLists = (
  meeting: Partial<Pick<MeetingDetail, 'segments' | 'speakers'>>,
) => ({
  segments: meeting.segments ?? NO_SEGMENTS,
  speakers: meeting.speakers ?? NO_SPEAKERS,
});
