export const finishLogin = (input: { topicId: string }) => {
  window.location.assign(`/chat?topic=${encodeURIComponent(input.topicId)}`);
};
