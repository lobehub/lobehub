interface AuthParams {
  headers?: HeadersInit;
  provider?: string;
}

export const createHeaderWithAuth = async (params?: AuthParams): Promise<HeadersInit> => {
  return { ...params?.headers };
};
