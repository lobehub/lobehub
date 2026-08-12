export const deriveGoalTitle = (instruction: string) => {
  const normalized = instruction.trim();
  const firstSentence = normalized.split(/[\n，。！？!?]/)[0].trim();

  return (firstSentence || normalized).slice(0, 48);
};
