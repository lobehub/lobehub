import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

/** Load the same env layers as Next before importing the DB adapter. */
export const loadPageCollaborationEnvironment = (): void => {
  const environment = process.env.NODE_ENV || 'development';
  dotenvExpand.expand(dotenv.config());
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}` }));
  dotenvExpand.expand(dotenv.config({ override: true, path: '.env.local' }));
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}.local` }));
};
