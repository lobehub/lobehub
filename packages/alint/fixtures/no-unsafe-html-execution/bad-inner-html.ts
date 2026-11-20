export const renderMessage = (element: HTMLElement, input: { modelHtml: string }) => {
  // alint-expect
  element.innerHTML = input.modelHtml;
};
