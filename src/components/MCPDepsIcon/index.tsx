'use client';

import SiApachemaven from '@icons-pack/react-simple-icons/icons/SiApachemaven';
import SiBlender from '@icons-pack/react-simple-icons/icons/SiBlender';
import SiBun from '@icons-pack/react-simple-icons/icons/SiBun';
import SiDeno from '@icons-pack/react-simple-icons/icons/SiDeno';
import SiDocker from '@icons-pack/react-simple-icons/icons/SiDocker';
import SiGit from '@icons-pack/react-simple-icons/icons/SiGit';
import SiGo from '@icons-pack/react-simple-icons/icons/SiGo';
import SiHelm from '@icons-pack/react-simple-icons/icons/SiHelm';
import SiKubernetes from '@icons-pack/react-simple-icons/icons/SiKubernetes';
import SiNodedotjs from '@icons-pack/react-simple-icons/icons/SiNodedotjs';
import SiNpm from '@icons-pack/react-simple-icons/icons/SiNpm';
import SiPipx from '@icons-pack/react-simple-icons/icons/SiPipx';
import SiPnpm from '@icons-pack/react-simple-icons/icons/SiPnpm';
import SiPython from '@icons-pack/react-simple-icons/icons/SiPython';
import SiRust from '@icons-pack/react-simple-icons/icons/SiRust';
import SiYarn from '@icons-pack/react-simple-icons/icons/SiYarn';
import { cssVar, Icon, Tooltip } from '@lobehub/ui';
import { memo } from 'react';

import Java from './Java';
import PowerShell from './PowerShell';
import Terminal from './Terminal';
import UV from './UV';

const icons: any = {
  blender: SiBlender,
  bun: SiBun,
  bunx: SiBun,
  deno: SiDeno,
  docker: SiDocker,
  git: SiGit,
  go: SiGo,
  helm: SiHelm,
  java: Java,
  kubectl: SiKubernetes,
  make: Terminal,
  manual: Terminal,
  maven: SiApachemaven,
  nodejs: SiNodedotjs,
  npm: SiNpm,
  npx: SiNpm,
  odbc: Terminal,
  pandoc: Terminal,
  pipx: SiPipx,
  pnpm: SiPnpm,
  pnpx: SiPnpm,
  powershell: PowerShell,
  python: SiPython,
  rust: SiRust,
  sh: Terminal,
  uv: UV,
  uvx: UV,
  yarn: SiYarn,
};

const InstallationIcon = memo<{ size?: number; type: string }>(({ type, size = 20 }) => {
  const iconType = type.split(' ')[0];
  if (iconType === 'none') return;
  return (
    <Tooltip title={iconType}>
      <Icon fill={cssVar.colorTextDescription} icon={icons?.[iconType] || Terminal} size={size} />
    </Tooltip>
  );
});

export default InstallationIcon;
