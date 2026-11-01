export const getGreetingKey = (hour: number): 'afternoon' | 'evening' | 'morning' => {
  if (hour < 6) return 'evening';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
};
