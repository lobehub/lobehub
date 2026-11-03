// The host fetches a fixed service endpoint; the URL is data for the isolated sandbox.
export const remoteFetch = (input: { url: string }) =>
  fetch('https://sandbox.example.com/run', {
    body: JSON.stringify({ tool: 'fetch', url: input.url }),
    method: 'POST',
  });
