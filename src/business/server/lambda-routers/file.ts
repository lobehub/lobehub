export interface BusinessFileUploadCheckParams {
  actualSize: number;
  clientIp?: string;
  inputSize: number;
  url: string;
  userId: string;
}

export async function businessFileUploadCheck(
   
  _params: BusinessFileUploadCheckParams,
): Promise<void> {}
