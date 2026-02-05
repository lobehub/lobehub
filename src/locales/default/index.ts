import agentGroup from './agentGroup';
import auth from './auth';
import authError from './authError';
import changelog from './changelog';
import chat from './chat';
import color from './color';
import common from './common';
import components from './components';
import desktopOnboarding from './desktop-onboarding';
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
import suggestQuestions from './suggestQuestions';
import thread from './thread';
import tool from './tool';
import topic from './topic';
import ui from './ui';
import welcome from './welcome';

const resources = {
  agentGroup,
  auth,
  authError,
  changelog,
  chat,
  color,
  common,
  components,
  'desktop-onboarding': desktopOnboarding,
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
  suggestQuestions,
  thread,
  tool,
  topic,
  ui,
  welcome,
} as const;

export default resources;
