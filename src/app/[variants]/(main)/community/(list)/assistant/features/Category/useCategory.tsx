import {
  BadgeDollarSignIcon,
  BriefcaseIcon,
  Coffee,
  DramaIcon,
  GamepadIcon,
  GraduationCapIcon,
  ImageIcon,
  LanguagesIcon,
  LaughIcon,
  Layers,
  LayoutPanelTop,
  MicroscopeIcon,
  PencilIcon,
  PrinterIcon,
  TerminalSquareIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AssistantCategory } from '@/types/discover';

export const useCategory = () => {
  const { t } = useTranslation('discover');

  return useMemo(
    () => [
      {
        icon: LayoutPanelTop,
        key: AssistantCategory.All,
        label: t('category.assistant.all'),
      },
      {
        icon: MicroscopeIcon,
        key: AssistantCategory.Academic,
        label: t('category.assistant.academic'),
      },
      {
        icon: BriefcaseIcon,
        key: AssistantCategory.Career,
        label: t('category.assistant.career'),
      },
      {
        icon: PencilIcon,
        key: AssistantCategory.CopyWriting,
        label: t('category.assistant.copywriting'),
      },
      {
        icon: ImageIcon,
        key: AssistantCategory.Design,
        label: t('category.assistant.design'),
      },
      {
        icon: GraduationCapIcon,
        key: AssistantCategory.Education,
        label: t('category.assistant.education'),
      },
      {
        icon: LaughIcon,
        key: AssistantCategory.Emotions,
        label: t('category.assistant.emotions'),
      },
      {
        icon: DramaIcon,
        key: AssistantCategory.Entertainment,
        label: t('category.assistant.entertainment'),
      },
      {
        icon: GamepadIcon,
        key: AssistantCategory.Games,
        label: t('category.assistant.games'),
      },
      {
        icon: Layers,
        key: AssistantCategory.General,
        label: t('category.assistant.general'),
      },
      {
        icon: Coffee,
        key: AssistantCategory.Life,
        label: t('category.assistant.life'),
      },
      {
        icon: BadgeDollarSignIcon,
        key: AssistantCategory.Marketing,
        label: t('category.assistant.marketing'),
      },
      {
        icon: PrinterIcon,
        key: AssistantCategory.Office,
        label: t('category.assistant.office'),
      },
      {
        icon: TerminalSquareIcon,
        key: AssistantCategory.Programming,
        label: t('category.assistant.programming'),
      },
      {
        icon: LanguagesIcon,
        key: AssistantCategory.Translation,
        label: t('category.assistant.translation'),
      },
    ],
    [t],
  );
};

export const useCategoryItem = (key?: AssistantCategory) => {
  const items = useCategory();
  if (!key) return;
  return items.find((item) => item.key === key);
};
