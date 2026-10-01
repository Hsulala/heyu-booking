import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../lib/admin-auth.mjs';

test('admin passwords are salted and verified with scrypt', () => {
  const first = hashPassword('secure-password', 'salt-one');
  const second = hashPassword('secure-password', 'salt-two');
  assert.notEqual(first, second);
  assert.equal(verifyPassword('secure-password', first), true);
  assert.equal(verifyPassword('wrong-password', first), false);
  assert.doesNotMatch(first, /secure-password/);
});
