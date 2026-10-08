export const renderHtml = (element: HTMLElement, input: { html: string }) => {
  const cleaned = input.html.replaceAll(/<script[\s\S]*?<\/script>/gi, '');
  // alint-expect
  element.innerHTML = cleaned;
};
