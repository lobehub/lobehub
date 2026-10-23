const PGVECTOR_HINT = `⚠️ Database migrate failed due to \`pgvector\` extension not found. Please install the \`pgvector\` extension on your postgres instance.

1) if you are using docker postgres image:
you can just use \`pgvector/pgvector:pg16\` image instead of \`postgres\`, e.g:

\`\`\`
docker run -p 5432:5432 -d --name pg -e POSTGRES_PASSWORD=mysecretpassword pgvector/pgvector:pg16
\`\`\`

2) if you are using cloud postgres instance, please contact your cloud provider for help.

if you have any other question, please open issue here: https://github.com/lobehub/lobehub/issues
`;

const DB_FAIL_INIT_HINT = `------------------------------------------------------------------------------------------
⚠️ Database migrate failed due to not find the db instance.

if you are using docker postgres image, you may need to set DATABASE_DRIVER to node

\`\`\`
DATABASE_DRIVER=node
\`\`\`

if you have any other question, please open issue here: https://github.com/lobehub/lobehub/issues
`;

const DUPLICATE_EMAIL_HINT = `------------------------------------------------------------------------------------------
⚠️ Database migration failed due to duplicate email addresses in the users table.

The database schema requires each email to be unique, but multiple users currently share the same email value.

Recommended solutions (choose one and rerun the migration):

1) Update duplicate emails to make them unique: change the conflicting email addresses to another unique email address or just change them email to NULL
2) Remove duplicate user records (dangerously, only if safe to delete)

⚠️ IMPORTANT: Always backup your database before making any changes!

To find duplicate emails, run this query:

\`\`\`sql
SELECT email, COUNT(*) as count
FROM users
WHERE email IS NOT NULL
GROUP BY email
HAVING COUNT(*) > 1;
\`\`\`

If you need further assistance, please open an issue: https://github.com/lobehub/lobehub/issues
`;

module.exports = {
  DB_FAIL_INIT_HINT,
  DUPLICATE_EMAIL_HINT,
  PGVECTOR_HINT,
};
