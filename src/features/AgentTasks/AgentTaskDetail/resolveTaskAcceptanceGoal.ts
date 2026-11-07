interface TaskAcceptanceSource {
  description?: string | null;
  instruction?: string | null;
  name?: string | null;
}

export const resolveTaskAcceptanceGoal = ({
  description,
  instruction,
  name,
}: TaskAcceptanceSource) => instruction?.trim() || description?.trim() || name?.trim() || '';
