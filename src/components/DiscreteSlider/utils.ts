interface NumericOption {
  value: number;
}

export const findClosestOptionIndex = (
  options: readonly NumericOption[],
  value: number,
): number => {
  if (options.length === 0) return 0;
  if (!Number.isFinite(value)) return 0;

  return options.reduce((closestIndex, option, index) => {
    const closestDistance = Math.abs(options[closestIndex].value - value);
    const distance = Math.abs(option.value - value);

    return distance < closestDistance ? index : closestIndex;
  }, 0);
};
