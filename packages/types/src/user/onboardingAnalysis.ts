export type OnboardingAnalysisItemStatus = 'pending' | 'running' | 'done';

export interface OnboardingAnalysisFact {
  id: string;
  label: string;
}

export interface OnboardingAnalysisProgressItem {
  id: string;
  status: OnboardingAnalysisItemStatus;
}

export interface OnboardingAnalysisStatus {
  done: boolean;
  facts: OnboardingAnalysisFact[];
  items: OnboardingAnalysisProgressItem[];
}

export interface OnboardingProfileResult {
  identity: string[];
  name: string;
  subtitle: string;
  tagline: string;
}
