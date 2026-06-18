import { registerBuiltinToolSurfaces as registerSurfaces } from '@lobechat/builtin-tools/register';

let registered = false;

export const registerBuiltinToolSurfaces = () => {
  if (registered) return;
  registered = true;

  registerSurfaces();
};
