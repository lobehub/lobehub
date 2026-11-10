/**
 * The host refused an answer before sending it, and already told the user why
 * (a toast). Not a failed send: the form leaves its submitting state and keeps
 * the draft, without a "could not send" alert.
 */
export class ClarificationAnswerDeclined extends Error {
  constructor() {
    super('The host declined this answer before sending it');
    this.name = 'ClarificationAnswerDeclined';
  }
}

/**
 * Hands the answers to the host. A host that returns `false` declined them:
 * that throws, since the form only leaves its submitting state on a throw — a
 * normal return means "sent, wait for the card to settle".
 */
export const submitClarification = async <T>(
  onSubmit: (answers: T) => Promise<boolean | void> | boolean | void,
  answers: T,
) => {
  if ((await onSubmit(answers)) === false) throw new ClarificationAnswerDeclined();
};
