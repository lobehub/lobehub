/** What a local report cannot do: anything that needs another person or a server. */
export const needsPublishedAcceptance = (what: string) =>
  new Error(
    `${what} needs a shared acceptance. Publish this report to LobeHub with \`lh acceptance publish\`.`,
  );
