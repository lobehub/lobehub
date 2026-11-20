// Fixture: a store action annotates its result with the service's inferred return type.
import { taskService } from '@/services/task';

export const runTask = async (
  id: string,
  onError: (error: unknown) => void,
): Promise<boolean> => {
  // alint-expect
  let result: Awaited<ReturnType<typeof taskService.run>>;
  try {
    result = await taskService.run(id);
  } catch (error) {
    onError(error);
    return false;
  }
  return result.success;
};
