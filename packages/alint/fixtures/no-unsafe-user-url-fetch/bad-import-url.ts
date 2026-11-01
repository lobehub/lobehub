export const importSkill = async (input: { url: string }) => {
  // alint-expect
  const response = await fetch(input.url);
  return response.text();
};
