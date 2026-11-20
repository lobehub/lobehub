/** The failure half of a device file preview result. */
export interface DeviceLocalFilePreviewFailure {
  /** Terminal failure: the file is gone (`not_found`) or may not be read (`forbidden`). */
  code?: 'forbidden' | 'not_found';
  error?: string;
}
