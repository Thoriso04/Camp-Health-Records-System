const bcrypt = require('bcryptjs');

describe('Cryptographic Utilities', () => {
  it('should correctly hash and verify passwords', async () => {
    const password = 'SecurePassword123!';
    const hash = await bcrypt.hash(password, 10);

    expect(hash).toBeDefined();
    expect(hash).not.toEqual(password);

    const isValid = await bcrypt.compare(password, hash);
    expect(isValid).toBe(true);

    const isInvalid = await bcrypt.compare('WrongPassword', hash);
    expect(isInvalid).toBe(false);
  });
});