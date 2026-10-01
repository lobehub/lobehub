import { type PortalImpl } from '../type';
import { ChapterBody, ReportBody } from './Body';
import { ChapterTitle, ReportTitle } from './Title';

/** The Goal report's full text, opened from the result page's 探索过程. */
export const GoalReport: PortalImpl = { Body: ReportBody, Title: ReportTitle };

/** One storyline chapter's local map — its main path and the detours off it. */
export const GoalReportChapter: PortalImpl = { Body: ChapterBody, Title: ChapterTitle };
