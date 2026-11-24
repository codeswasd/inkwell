import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

export const SEED_PASSWORD = 'demo1234';

// Seeded demo accounts (the assignment allows mocked users). Passwords are stored only as scrypt hashes.
const SEED = [
  { id: 'alice', name: 'Alice Chen', email: 'alice@ajaia.dev', color: '#c4a7ff' },
  { id: 'bob', name: 'Bob Rivera', email: 'bob@ajaia.dev', color: '#7cc7ff' },
  { id: 'carol', name: 'Carol Okafor', email: 'carol@ajaia.dev', color: '#ffb07a' },
];

const hash = (pw, salt) => scryptSync(pw, salt, 32);

export const USERS = SEED.map((u) => {
  const salt = randomBytes(16);
  return { ...u, salt, passwordHash: hash(SEED_PASSWORD, salt) };
});

export function checkPassword(user, password) {
  const candidate = hash(String(password), user.salt);
  return candidate.length === user.passwordHash.length && timingSafeEqual(candidate, user.passwordHash);
}
