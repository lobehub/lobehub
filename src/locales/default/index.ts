import { businessLocales } from '@/business/locales/index';

import auth from './auth';
import authError from './authError';
import changelog from './changelog';
import chat from './chat';
import clerk from './clerk';
import color from './color';
import common from './common';
import components from './components';
import discover from './discover';
import editor from './editor';
import electron from './electron';
import error from './error';
import file from './file';
import home from './home';
import hotkey from './hotkey';
import image from './image';
import knowledgeBase from './knowledgeBase';
import labs from './labs';
import marketAuth from './marketAuth';
import memory from './memory';
import metadata from './metadata';
import migration from './migration';
import modelProvider from './modelProvider';
import models from './models';
import oauth from './oauth';
import onboarding from './onboarding';
import plugin from './plugin';
import portal from './portal';
import providers from './providers';
import ragEval from './ragEval';
import setting from './setting';
import spend from './spend';
import subscription from './subscription';
import thread from './thread';
import tool from './tool';
import topic from './topic';
import ui from './ui';
import welcome from './welcome';

const resources = {
  auth,
  authError,
  changelog,
  chat,
  clerk,
  color,
  common,
  components,
  discover,
  editor,
  electron,
  error,
  file,
  home,
  hotkey,
  image,
  knowledgeBase,
  labs,

  marketAuth,
  memory,
  metadata,
  migration,
  modelProvider,
  models,
  oauth,
  onboarding,
  plugin,
  portal,
  providers,
  ragEval,
  setting,
  spend,
  subscription,
  thread,
  tool,
  topic,
  ui,
  welcome,

  ...businessLocales,
} as const;

export default resources;
