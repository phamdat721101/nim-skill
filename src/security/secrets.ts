/** Secret-field detection and safe redaction shared by session storage and observability. */

const SECRET_FIELD = /(?:^|[_\-.])(seed|private[_-]?key|secret|mnemonic|token|password|authorization|bearer)(?:$|[_\-.])/i;
const RAW_SECRET = /((?:seed|private[_-]?key|secret|mnemonic|token|password|authorization|bearer)[\w.-]*\s*[:=]\s*)(["']?)([^\s,"'}\]]+)\2/gi;

export class SecretFieldError extends Error {
  constructor(readonly path: string) {
    super(`secret-like field is not allowed at ${path}`);
    this.name = 'SecretFieldError';
  }
}

export function isSecretField(name: string): boolean {
  return SECRET_FIELD.test(name);
}

/** Reject secret-shaped object keys without ever including their values in an error. */
export function assertNoSecrets(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (isSecretField(key)) throw new SecretFieldError(childPath);
    assertNoSecrets(nested, childPath);
  }
}

/** Return a deep redacted copy suitable for traces and structured logs. */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, isSecretField(key) ? '[REDACTED]' : redactSecrets(nested)]),
  ) as T;
}

/** Redact common key/value secret forms before raw output reaches an agent or sink. */
export function redactSecretText(text: string): string {
  return text.replace(RAW_SECRET, '$1[REDACTED]');
}
