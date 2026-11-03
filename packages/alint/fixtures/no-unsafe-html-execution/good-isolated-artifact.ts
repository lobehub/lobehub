export const renderArtifact = (frame: HTMLIFrameElement, input: { html: string }) => {
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = input.html;
};
