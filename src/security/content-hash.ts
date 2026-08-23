/** Stable local content hashes shared by artifact and drift-audit helpers. */
import { createHash } from 'node:crypto';

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
