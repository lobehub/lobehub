export const lookup = async (input: { query: string }) =>
  fetch(`https://api.example.com/search?q=${encodeURIComponent(input.query)}`);
