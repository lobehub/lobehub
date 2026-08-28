export const acceptanceHomePath = () => '/';

export const acceptanceOverviewPath = (acceptanceId: string) =>
  `/acceptance/${encodeURIComponent(acceptanceId)}`;

export const acceptanceCheckPath = (acceptanceId: string, checkId: string) =>
  `${acceptanceOverviewPath(acceptanceId)}/check/${encodeURIComponent(checkId)}`;
