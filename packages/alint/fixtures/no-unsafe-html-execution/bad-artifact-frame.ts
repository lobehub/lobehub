export const renderArtifact = (frame: HTMLIFrameElement, input: { html: string }) => {
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  // alint-expect
  frame.srcdoc = input.html;
};
