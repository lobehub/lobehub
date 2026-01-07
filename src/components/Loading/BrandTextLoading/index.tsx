import { BRANDING_NAME } from '@lobechat/business-const';
import { BrandLoading, LobeHubText } from '@lobehub/ui/brand';

import { isCustomBranding } from '@/const/version';

import styles from './index.module.css';

interface BrandTextLoadingProps {
  debugId: string;
}

const BrandTextLoading = ({ debugId }: BrandTextLoadingProps) => {
  const showDebug = process.env.NODE_ENV === 'development' && debugId;

  return (
    <div className={styles.container}>
      {isCustomBranding ? (
        <div aria-label="Loading" className={styles.brand} role="status">
          <span aria-hidden className={styles.spinner} />
          <span className={styles.brandText}>{BRANDING_NAME}</span>
        </div>
      ) : (
        <div aria-label="Loading" className={styles.brand} role="status">
          <BrandLoading size={40} text={LobeHubText} />
        </div>
      )}
      {showDebug && (
        <div className={styles.debug}>
          <div className={styles.debugRow}>
            <span className={styles.debugLabel}>Debug ID:</span>
            <span className={styles.debugTag}>
              <code className={styles.debugCode}>{debugId}</code>
            </span>
          </div>
          <div className={styles.debugHint}>only visible in development</div>
        </div>
      )}
    </div>
  );
};

export default BrandTextLoading;
