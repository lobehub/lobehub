/** Keep workspace loss visible even when the command itself completed successfully. */
export const formatSandboxRecreation = (content: string, recreated?: boolean): string =>
  recreated
    ? `Warning: The sandbox session expired and was recreated. Files from the previous session may have been lost. Inform the user and ask before regenerating previous work.\n\n${content}`
    : content;
