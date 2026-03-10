const isCloudDeployment = () => process.env.VERCEL === '1';

/**
 * Legacy cloud guardrail:
 * - keep minimum 30-minute interval for hosted multi-tenant deployment
 * - only for 5-field cron patterns
 */
export const isCronPatternAtLeast30Minutes = (pattern: string): boolean => {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour] = parts;

  // minute must be 0 / 30 / */N(>=30)
  if (minute === '0' || minute === '30') {
    if (hour === '*') return true;

    if (hour.startsWith('*/')) {
      const interval = Number.parseInt(hour.slice(2), 10);
      return !Number.isNaN(interval) && interval >= 1;
    }

    if (/^\d+$/.test(hour)) {
      const h = Number.parseInt(hour, 10);
      return !Number.isNaN(h) && h >= 0 && h <= 23;
    }

    return false;
  }

  if (minute.startsWith('*/')) {
    const interval = Number.parseInt(minute.slice(2), 10);
    return !Number.isNaN(interval) && interval >= 30;
  }

  return false;
};

export const validateCronPatternByDeployment = (cronPattern: string) => {
  if (!isCloudDeployment()) {
    return { valid: true } as const;
  }

  if (!isCronPatternAtLeast30Minutes(cronPattern)) {
    return {
      message:
        'Cloud deployment requires minimum execution interval of 30 minutes. Use self-hosting for unrestricted cron expressions.',
      valid: false,
    } as const;
  }

  return { valid: true } as const;
};
