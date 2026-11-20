export const runModelTransform = (input: { modelGeneratedCode: string; value: string }) => {
  // alint-expect
  const transform = new Function('value', input.modelGeneratedCode);
  return transform(input.value);
};
