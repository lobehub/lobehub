export interface BusinessFileUploadCheckParams {
  actualSize: number;
  clientIp?: string;
  inputSize: number;
  url: string;
  userId: string;
}

export async function businessFileUploadCheck(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _params: BusinessFileUploadCheckParams,
): Promise<void> {}
