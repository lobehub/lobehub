/**
 * Where an Agent's opening puts its acknowledgement and the Thread its reply moves into.
 *
 * - `inline`: no Thread. The acknowledgement answers the request where it was asked, and the reply
 *   follows it there.
 * - `underRequest`: the Thread opens under the request and the acknowledgement is its first reply,
 *   so a shared timeline gains only the Thread's entry.
 * - `underAck`: the acknowledgement answers the request where it was asked and the Thread opens
 *   under it, so the person sees the reply start and where it went. Without an acknowledgement
 *   the Thread opens under the request.
 */
export type OpeningLayout = 'inline' | 'underAck' | 'underRequest';

/** What the layout depends on, gathered before anything is posted. */
export interface OpeningFacts {
  /** The opener posts an acknowledgement. */
  acknowledges: boolean;
  /** Other Agents were asked the same request and still owe an answer to it. */
  coAddressed: boolean;
  /** The request is already inside a Thread, so the reply cannot move into a new one. */
  inThread: boolean;
  /** An archived Thread sits under the request: it takes no new work. */
  requestHasArchivedThread: boolean;
  /** A Thread someone can still answer in already sits under the request. */
  requestHasOpenThread: boolean;
  /** More than one person is in the Channel, so its main timeline is shared. */
  sharedTimeline: boolean;
  /** The opener named a Thread for the reply. */
  wantsThread: boolean;
}

/** The order rules apply in; the first that matches decides the layout. */
const OPENING_RULES: { layout: OpeningLayout; when: (facts: OpeningFacts) => boolean }[] = [
  // It already runs in a Thread.
  { layout: 'inline', when: (f) => f.inThread },
  // Agents asked together answer together in one Thread under the request: the first to want a
  // Thread opens it, and the others join it once open, even one that would answer in place.
  {
    layout: 'underRequest',
    when: (f) =>
      f.coAddressed && !f.requestHasArchivedThread && (f.wantsThread || f.requestHasOpenThread),
  },
  // The opener judged the reply short.
  { layout: 'inline', when: (f) => !f.wantsThread },
  // A shared timeline stays quiet: everything about the reply goes in the request's Thread.
  { layout: 'underRequest', when: (f) => f.sharedTimeline && !f.requestHasArchivedThread },
  // Nothing new to hang a Thread under, and the request's Thread is archived.
  { layout: 'inline', when: (f) => !f.acknowledges && f.requestHasArchivedThread },
  // A direct conversation, or a group whose request already has an archived Thread.
  { layout: 'underAck', when: () => true },
];

export const chooseOpeningLayout = (facts: OpeningFacts): OpeningLayout =>
  OPENING_RULES.find(({ when }) => when(facts))!.layout;
