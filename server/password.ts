import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP's 16 MiB scrypt profile fits Workers' memory budget.
const N = 16384;
const r = 8;
const p = 5;
const prefix = `scrypt$v1$${N}$${r}$${p}`;
const dummySalt = '00000000000000000000000000000000';

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) =>
  Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );

function derive(password: string, salt: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scrypt(password, unhex(salt), 32, { N, r, p, maxmem: 32 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = hex(randomBytes(16));
  return `${prefix}$${salt}$${hex(await derive(password, salt))}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = encoded?.split('$');
  if (
    parts &&
    (parts.length !== 7 ||
      parts.slice(0, 5).join('$') !== prefix ||
      !/^[a-f0-9]{32}$/.test(parts[5]) ||
      !/^[a-f0-9]{64}$/.test(parts[6]))
  )
    throw new Error('Unsupported stored password hash version.');
  const actual = await derive(password, parts?.[5] ?? dummySalt);
  const expected = parts ? unhex(parts[6]) : new Uint8Array(32);
  const matches = timingSafeEqual(actual, expected);
  return encoded !== null && matches;
}
