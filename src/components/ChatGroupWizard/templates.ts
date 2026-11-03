import { useTranslation } from 'react-i18next';

export interface GroupTemplate {
  description: string;
  id: string;
  members: Array<{
    avatar: string;
    backgroundColor?: string;
    plugins?: string[];
    systemRole: string;
    title: string;
  }>;
  title: string;
}

export const useGroupTemplates = (): GroupTemplate[] => {
  const { t } = useTranslation('welcome');

  const templateKeys = [
    'brainstorm',
    'analysis',
    'writing',
    'planning',
    'product',
    'game',
  ] as const;

  return templateKeys.map((key) => ({
    description: t(`guide.groupTemplates.${key}.description`),
    id: key,
    members: t(`guide.groupTemplates.${key}.members`, {
      returnObjects: true,
    }) as GroupTemplate['members'],
    title: t(`guide.groupTemplates.${key}.title`),
  }));
};
