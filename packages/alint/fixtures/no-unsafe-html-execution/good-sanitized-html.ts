import DOMPurify from 'dompurify';

export const renderMessage = (element: HTMLElement, input: { html: string }) => {
  element.innerHTML = DOMPurify.sanitize(input.html);
};
