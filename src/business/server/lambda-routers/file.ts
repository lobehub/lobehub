export interface BusinessFileUploadCheckParams {
  actualSize: number;
  clientIp?: string;
  inputSize: number;
  url: string;
  userId: string;
}

/**
 * Business check for file upload validation.
 * Override this in cloud repo to implement risk control for malicious uploads.
 */
export async function businessFileUploadCheck(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  params: BusinessFileUploadCheckParams,
): Promise<void> {
  // no-op in open source version
}
