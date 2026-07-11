function assertEqual(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

function manualInboxStatus(addressExists: boolean, inSession: boolean): number {
  if (addressExists && inSession) return 200;
  return addressExists ? 200 : 201;
}

assertEqual(manualInboxStatus(false, false), 201);
assertEqual(manualInboxStatus(true, false), 200);
assertEqual(manualInboxStatus(true, true), 200);
