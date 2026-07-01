const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export interface ParsedAddress {
  localPart: string;
  domain: string;
}

export function getDomains(mailDomain: string): string[] {
  return mailDomain
    .split(',')
    .map(normalizeDomain)
    .filter(Boolean);
}

export function defaultDomain(mailDomain: string): string {
  return getDomains(mailDomain)[0] || 'example.com';
}

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase();
}

export function validateLocalPart(value: string): string | null {
  const localPart = value.trim().toLowerCase();
  if (!LOCAL_PART_RE.test(localPart)) return null;
  if (localPart.includes('..')) return null;
  return localPart;
}

export function buildAddress(localPart: string, domain: string): string {
  return `${localPart}@${normalizeDomain(domain)}`;
}

export function parseAddress(address: string): ParsedAddress | null {
  const normalized = address.trim().toLowerCase();
  const parts = normalized.split('@');
  if (parts.length !== 2) return null;

  const localPart = validateLocalPart(parts[0]);
  const domain = normalizeDomain(parts[1]);
  if (!localPart || !domain) return null;

  return { localPart, domain };
}

export function isAllowedAddress(address: string, domains: string[]): boolean {
  const parsed = parseAddress(address);
  return !!parsed && domains.includes(parsed.domain);
}
