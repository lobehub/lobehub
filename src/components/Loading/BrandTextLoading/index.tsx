import './index.css';

import { BrandLoading, LobeHubText } from '@lobehub/ui/brand';
import * as stylex from '@stylexjs/stylex';

import { isCustomBranding } from '@/const/version';

import CircleLoading from '../CircleLoading';

const stylesAtomic = stylex.create({
  debug: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '16px',
  },
  debugHint: { fontSize: '12px', color: 'var(--brand-muted-color)' },
});

interface BrandTextLoadingProps {
  debugId: string;
}

const BrandTextLoading = ({ debugId }: BrandTextLoadingProps) => {
  if (isCustomBranding)
    return (
      <div className={'lobe-brand-text-loading-15b392f3-container'}>
        <CircleLoading />
      </div>
    );

  const showDebug = process.env.NODE_ENV === 'development' && debugId;

  return (
    <div className={'lobe-brand-text-loading-15b392f3-container'}>
      <div aria-label="Loading" className={'lobe-brand-text-loading-15b392f3-brand'} role="status">
        <BrandLoading size={40} text={LobeHubText} />
      </div>
      {showDebug && (
        <div {...stylex.props(stylesAtomic['debug'])}>
          <div className={'lobe-brand-text-loading-15b392f3-debug-row'}>
            <code>Debug ID:</code>
            <span className={'lobe-brand-text-loading-15b392f3-debug-tag'}>
              <code>{debugId}</code>
            </span>
          </div>
          <div {...stylex.props(stylesAtomic['debugHint'])}>only visible in development</div>
        </div>
      )}
    </div>
  );
};

export default BrandTextLoading;
