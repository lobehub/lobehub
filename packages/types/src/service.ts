export interface BatchTaskResult {
  added: number;
  errors?: Error[];
  ids: string[];
  skips: string[];
  success: boolean;
}
