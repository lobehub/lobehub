import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

export const flowStateColor = (state?: string) => {
  switch (state) {
    case undefined: {
      return cssVar.colorTextQuaternary;
    }
    case 'passed': {
      return cssVar.colorSuccess;
    }
    case 'failed': {
      return cssVar.colorError;
    }
    default: {
      return cssVar.colorWarning;
    }
  }
};
