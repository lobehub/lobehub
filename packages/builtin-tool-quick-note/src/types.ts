import type { QuickNoteResourceType } from '@lobechat/types';

export const QuickNoteApiName = {
  /** Records the follow-up run's output for a judged Quick Note and ends the run. */
  submitResult: 'submitResult',
} as const;

export type QuickNoteApiNameType = (typeof QuickNoteApiName)[keyof typeof QuickNoteApiName];

/** Arguments of `submitResult`: the whole output of one Quick Note follow-up run. */
export interface SubmitQuickNoteResultParams {
  /** Short literal search terms for related Topics and Documents. */
  contextQueries?: string[];
  /** The draft for the planned delegate preset; its shape is given in the run instructions. */
  delegate?: Record<string, unknown>;
  /** Supplied context candidates that are clearly related, with their exact type and id. */
  relatedResources?: {
    id: string;
    selector?: Record<string, unknown>;
    type: QuickNoteResourceType;
  }[];
  /** Markdown overview of the note. */
  summary: string;
  /** At most five short tags. */
  tags?: string[];
}
