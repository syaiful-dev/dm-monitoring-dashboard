// Generate a bcrypt hash for the admin password.
// Usage:  node scripts/hash-password.js "yourPassword"
// Then put the printed value into .env as ADMIN_PASSWORD_HASH=...

const bcrypt = require('bcryptjs');

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/hash-password.js "yourPassword"');
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 10);
console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n');
