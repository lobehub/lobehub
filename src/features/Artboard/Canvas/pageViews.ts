export const createPageViews = <View>() => {
  const saved = new Map<string, View>();
  return {
    swap: (from: string | undefined, to: string | undefined, current: View) => {
      if (from) saved.set(from, current);
      return to ? saved.get(to) : undefined;
    },
  };
};
