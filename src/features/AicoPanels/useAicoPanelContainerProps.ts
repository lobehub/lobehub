import { useIsMobile } from '@/hooks/useIsMobile';

/** Padding / sizing for Aico panel pages wrapped in SettingContainer. */
export const useAicoPanelContainerProps = (maxWidth: number = 960) => {
  const mobile = useIsMobile();

  return {
    flex: 1 as const,
    maxWidth,
    paddingBlock: mobile ? ('16px 32px' as const) : ('24px 48px' as const),
    paddingInline: mobile ? 12 : 24,
    style: { minHeight: 0, overflowX: 'auto' as const },
  };
};
