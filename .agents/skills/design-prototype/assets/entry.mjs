import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';

import { Amp, ClaudeCode, Codex, HermesAgent, OpenClaw, OpenCode } from '@lobehub/icons';
import * as ui from '@lobehub/ui';
import * as lucide from 'lucide-react';
import * as motionReact from 'motion/react';
import * as motionReactM from 'motion/react-m';
import * as react from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactDom from 'react-dom';
import * as reactDomClient from 'react-dom/client';

export default {
  '@lobehub/icons': { Amp, ClaudeCode, Codex, HermesAgent, OpenClaw, OpenCode },
  '@lobehub/ui': ui,
  'lucide-react': lucide,
  'motion/react': motionReact,
  'motion/react-m': motionReactM,
  'react': react,
  'react-dom': reactDom,
  'react-dom/client': reactDomClient,
  'react/jsx-runtime': jsxRuntime,
};
