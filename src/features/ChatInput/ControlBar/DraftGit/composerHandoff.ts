/**
 * What a send may still do to the composer once the git step returns.
 *
 * When git actually ran, the send waited seconds on it, in which the user may
 * have opened another conversation or kept typing. The captured draft still
 * goes to the conversation it was written in (`sendToOrigin`), and only that
 * draft leaves the composer: one now showing another conversation, or holding
 * newer text, keeps what it has. A send that waited on nothing clears as before.
 */
export const resolveComposerHandoff = ({
  acted,
  editorUnchanged,
  stillHere,
}: {
  acted: boolean;
  /** The editor still holds exactly the text that is being sent. */
  editorUnchanged: boolean;
  /** The composer still belongs to the conversation the send started in. */
  stillHere: boolean;
}) => ({
  clearEditor: !acted || (stillHere && editorUnchanged),
  sendToOrigin: acted && !stillHere,
});
