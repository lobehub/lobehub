const path = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const migrator = require('drizzle-orm/node-postgres/migrator');
const { PGVECTOR_HINT } = require('./errorHint');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set, please set it in your environment variables.');
}

const client = new Pool({ connectionString: process.env.DATABASE_URL });

const db = drizzle(client);

const runMigrations = async () => {
  console.log('[Database] Start to migration...');
  await migrator.migrate(db, {
    migrationsFolder: path.join(__dirname, './migrations'),
  });

  console.log('✅ database migration pass.');
  console.log('-------------------------------------');
  process.exit(0);
};

runMigrations().catch((err) => {
  console.error(
    '❌ Database migrate failed. Please check your database is valid and DATABASE_URL is set correctly. The error detail is below:',
  );
  console.error(err);

  if (err.message.includes('extension "vector" is not available')) {
    console.info(PGVECTOR_HINT);
  }

  process.exit(1);
});
