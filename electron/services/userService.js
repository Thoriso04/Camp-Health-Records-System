function resolveActiveUserId(db, suppliedUserId) {
  const getById = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1');
  const getByUsername = db.prepare('SELECT id FROM users WHERE username = ? AND is_active = 1');
  const legacyMatch = typeof suppliedUserId === 'string' ? /^usr-(.+)-01$/.exec(suppliedUserId) : null;
  const user = suppliedUserId == null
    ? null
    : getById.get(suppliedUserId) ?? (legacyMatch ? getByUsername.get(legacyMatch[1]) : null);

  if (!user) {
    throw new Error('No active database user matches the signed-in account. Sign in with a configured database user before saving.');
  }

  return user.id;
}

module.exports = { resolveActiveUserId };