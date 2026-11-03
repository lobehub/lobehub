import {
  AppleIcon,
  BarChart2Icon,
  BookIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  CalendarIcon,
  CheckSquareIcon,
  CloudIcon,
  DollarSignIcon,
  FileTextIcon,
  GamepadIcon,
  GitBranchIcon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  ImageIcon,
  LayoutPanelTopIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MicIcon,
  MonitorIcon,
  NetworkIcon,
  PlayIcon,
  SearchIcon,
  ServerIcon,
  ShieldIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  TerminalIcon,
  TruckIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SkillCategory } from '@/types/discover';

export const useSkillCategory = () => {
  const { t } = useTranslation('discover');
  return useMemo(
    () => [
      {
        icon: LayoutPanelTopIcon,
        key: SkillCategory.All,
        label: t('skills.categories.all.name'),
        title: t('skills.categories.all.description'),
      },
      // Sorted by category count (descending)
      {
        icon: BotIcon,
        key: SkillCategory.CodingAgentsIDEs,
        label: t('skills.categories.coding-agents-ides.name'),
        title: t('skills.categories.coding-agents-ides.description'),
      },
      {
        icon: MonitorIcon,
        key: SkillCategory.WebFrontendDevelopment,
        label: t('skills.categories.web-frontend-development.name'),
        title: t('skills.categories.web-frontend-development.description'),
      },
      {
        icon: CloudIcon,
        key: SkillCategory.DevOpsCloud,
        label: t('skills.categories.devops-cloud.name'),
        title: t('skills.categories.devops-cloud.description'),
      },
      {
        icon: SearchIcon,
        key: SkillCategory.SearchResearch,
        label: t('skills.categories.search-research.name'),
        title: t('skills.categories.search-research.description'),
      },
      {
        icon: GlobeIcon,
        key: SkillCategory.BrowserAutomation,
        label: t('skills.categories.browser-automation.name'),
        title: t('skills.categories.browser-automation.description'),
      },
      {
        icon: CheckSquareIcon,
        key: SkillCategory.ProductivityTasks,
        label: t('skills.categories.productivity-tasks.name'),
        title: t('skills.categories.productivity-tasks.description'),
      },
      {
        icon: BrainIcon,
        key: SkillCategory.AILLMs,
        label: t('skills.categories.ai-llms.name'),
        title: t('skills.categories.ai-llms.description'),
      },
      {
        icon: TerminalIcon,
        key: SkillCategory.CLIUtilities,
        label: t('skills.categories.cli-utilities.name'),
        title: t('skills.categories.cli-utilities.description'),
      },
      {
        icon: GitBranchIcon,
        key: SkillCategory.GitGitHub,
        label: t('skills.categories.git-github.name'),
        title: t('skills.categories.git-github.description'),
      },
      {
        icon: ImageIcon,
        key: SkillCategory.ImageVideoGeneration,
        label: t('skills.categories.image-video-generation.name'),
        title: t('skills.categories.image-video-generation.description'),
      },
      {
        icon: MessageCircleIcon,
        key: SkillCategory.Communication,
        label: t('skills.categories.communication.name'),
        title: t('skills.categories.communication.description'),
      },
      {
        icon: TruckIcon,
        key: SkillCategory.Transportation,
        label: t('skills.categories.transportation.name'),
        title: t('skills.categories.transportation.description'),
      },
      {
        icon: FileTextIcon,
        key: SkillCategory.PDFDocuments,
        label: t('skills.categories.pdf-documents.name'),
        title: t('skills.categories.pdf-documents.description'),
      },
      {
        icon: MegaphoneIcon,
        key: SkillCategory.MarketingSales,
        label: t('skills.categories.marketing-sales.name'),
        title: t('skills.categories.marketing-sales.description'),
      },
      {
        icon: HeartIcon,
        key: SkillCategory.HealthFitness,
        label: t('skills.categories.health-fitness.name'),
        title: t('skills.categories.health-fitness.description'),
      },
      {
        icon: PlayIcon,
        key: SkillCategory.MediaStreaming,
        label: t('skills.categories.media-streaming.name'),
        title: t('skills.categories.media-streaming.description'),
      },
      {
        icon: BookOpenIcon,
        key: SkillCategory.NotesPKM,
        label: t('skills.categories.notes-pkm.name'),
        title: t('skills.categories.notes-pkm.description'),
      },
      {
        icon: CalendarIcon,
        key: SkillCategory.CalendarScheduling,
        label: t('skills.categories.calendar-scheduling.name'),
        title: t('skills.categories.calendar-scheduling.description'),
      },
      {
        icon: ShoppingCartIcon,
        key: SkillCategory.ShoppingEcommerce,
        label: t('skills.categories.shopping-ecommerce.name'),
        title: t('skills.categories.shopping-ecommerce.description'),
      },
      {
        icon: ShieldIcon,
        key: SkillCategory.SecurityPasswords,
        label: t('skills.categories.security-passwords.name'),
        title: t('skills.categories.security-passwords.description'),
      },
      {
        icon: UserIcon,
        key: SkillCategory.PersonalDevelopment,
        label: t('skills.categories.personal-development.name'),
        title: t('skills.categories.personal-development.description'),
      },
      {
        icon: MicIcon,
        key: SkillCategory.SpeechTranscription,
        label: t('skills.categories.speech-transcription.name'),
        title: t('skills.categories.speech-transcription.description'),
      },
      {
        icon: AppleIcon,
        key: SkillCategory.AppleAppsServices,
        label: t('skills.categories.apple-apps-services.name'),
        title: t('skills.categories.apple-apps-services.description'),
      },
      {
        icon: HomeIcon,
        key: SkillCategory.SmartHomeIoT,
        label: t('skills.categories.smart-home-iot.name'),
        title: t('skills.categories.smart-home-iot.description'),
      },
      {
        icon: GamepadIcon,
        key: SkillCategory.Gaming,
        label: t('skills.categories.gaming.name'),
        title: t('skills.categories.gaming.description'),
      },
      {
        icon: WrenchIcon,
        key: SkillCategory.ClawdbotTools,
        label: t('skills.categories.clawdbot-tools.name'),
        title: t('skills.categories.clawdbot-tools.description'),
      },
      {
        icon: ServerIcon,
        key: SkillCategory.SelfHostedAutomation,
        label: t('skills.categories.self-hosted-automation.name'),
        title: t('skills.categories.self-hosted-automation.description'),
      },
      {
        icon: SmartphoneIcon,
        key: SkillCategory.IOSMacOSDevelopment,
        label: t('skills.categories.ios-macos-development.name'),
        title: t('skills.categories.ios-macos-development.description'),
      },
      {
        icon: BookIcon,
        key: SkillCategory.Moltbook,
        label: t('skills.categories.moltbook.name'),
        title: t('skills.categories.moltbook.description'),
      },
      {
        icon: BarChart2Icon,
        key: SkillCategory.DataAnalytics,
        label: t('skills.categories.data-analytics.name'),
        title: t('skills.categories.data-analytics.description'),
      },
      {
        icon: DollarSignIcon,
        key: SkillCategory.Finance,
        label: t('skills.categories.finance.name'),
        title: t('skills.categories.finance.description'),
      },
      {
        icon: NetworkIcon,
        key: SkillCategory.AgentToAgentProtocols,
        label: t('skills.categories.agent-to-agent-protocols.name'),
        title: t('skills.categories.agent-to-agent-protocols.description'),
      },
    ],
    [t],
  );
};

export const useSkillCategoryItem = (key?: string) => {
  const items = useSkillCategory();
  if (!key) return;
  return items.find((item) => item.key === key);
};
