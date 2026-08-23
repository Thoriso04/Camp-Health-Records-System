const bcrypt = require('bcryptjs');

async function hashPassword(plainPassword) {
  return await bcrypt.hash(plainPassword, 12);
}

async function verifyPassword(plainPassword, hashedPassword) {
  return await bcrypt.compare(plainPassword, hashedPassword);
}

module.exports = { hashPassword, verifyPassword };