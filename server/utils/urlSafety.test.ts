import { describe, expect, test } from 'bun:test';
import { assertPublicHttpUrl, isPrivateIp } from './urlSafety';

describe('isPrivateIp', () => {
  test.each([
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '198.18.0.1', '224.0.0.1',
    '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1',
  ])('%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true));

  test.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])(
    '%s is public',
    (ip) => expect(isPrivateIp(ip)).toBe(false)
  );
});

describe('assertPublicHttpUrl', () => {
  test.each([
    'ftp://example.com/x',
    'file:///etc/passwd',
    'http://127.0.0.1/',
    'http://localhost/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5:8080/',
  ])('rejects %s', async (u) => {
    await expect(assertPublicHttpUrl(u)).rejects.toThrow();
  });

  test('accepts a public IP literal', async () => {
    const url = await assertPublicHttpUrl('https://8.8.8.8/path');
    expect(url.hostname).toBe('8.8.8.8');
  });
});
