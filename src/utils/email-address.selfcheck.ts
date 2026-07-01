import {
  buildAddress,
  getDomains,
  isAllowedAddress,
  parseAddress,
  validateLocalPart,
} from './email-address';

function assertEqual(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

assertEqual(getDomains('Example.COM, payin.my.id'), ['example.com', 'payin.my.id']);
assertEqual(validateLocalPart('User_Name-1'), 'user_name-1');
assertEqual(validateLocalPart('a..b'), null);
assertEqual(validateLocalPart('-bad'), null);
assertEqual(validateLocalPart('bad@x'), null);
assertEqual(buildAddress('test', 'Example.COM'), 'test@example.com');
assertEqual(parseAddress('Test_1@Example.COM'), { localPart: 'test_1', domain: 'example.com' });
assertEqual(parseAddress('bad@@example.com'), null);
assertEqual(isAllowedAddress('test@example.com', ['example.com']), true);
assertEqual(isAllowedAddress('test@evil.com', ['example.com']), false);
