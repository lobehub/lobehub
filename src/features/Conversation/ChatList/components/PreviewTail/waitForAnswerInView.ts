export const HANDOFF_MAX_MS = 1000;
const STEADY_FRAMES = 2;

interface WaitForAnswerInViewOptions {
  container: HTMLElement;
  maxMs?: number;
  messageId: string;
  onReady: () => void;
}

const findAnswer = (container: HTMLElement, messageId: string) =>
  container.querySelector<HTMLElement>(`[id="${messageId}__answer"]`) ??
  container.querySelector<HTMLElement>(`[id="${messageId}"]`);

export const waitForAnswerInView = ({
  container,
  maxMs = HANDOFF_MAX_MS,
  messageId,
  onReady,
}: WaitForAnswerInViewOptions) => {
  let frame = 0;
  let lastBottom: number | undefined;
  let steady = 0;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    onReady();
  };
  const timer = setTimeout(finish, maxMs);

  const check = () => {
    const answer = findAnswer(container, messageId);
    const view = container.getBoundingClientRect();
    const bottom = answer?.getBoundingClientRect().bottom;
    const inView = bottom !== undefined && bottom > view.top && bottom <= view.bottom + 1;

    steady =
      inView && lastBottom !== undefined && Math.abs(bottom - lastBottom) < 1 ? steady + 1 : 0;
    lastBottom = inView ? bottom : undefined;
    if (steady >= STEADY_FRAMES) return finish();
    frame = requestAnimationFrame(check);
  };
  frame = requestAnimationFrame(check);

  return () => {
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
};
