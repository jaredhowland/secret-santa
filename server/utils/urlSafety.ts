import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const cidr of [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
]) {
  const [net, len] = cidr.split('/');
  blocked.addSubnet(net, Number(len), 'ipv4');
}
for (const cidr of [
  '::/96', // unspecified + IPv4-compatible
  '::1/128', '::ffff:0:0:0/96', '64:ff9b::/96', '2002::/16',
  'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8',
]) {
  const [net, len] = cidr.split('/');
  blocked.addSubnet(net, Number(len), 'ipv6');
}

/** Expands a valid IPv6 string to 8 16-bit groups. */
function ipv6Groups(ip: string): number[] {
  let s = ip.toLowerCase();
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    s = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family !== 6) return true; // fail closed
  const bare = ip.split('%')[0];
  const g = ipv6Groups(bare);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    // IPv4-mapped: apply the IPv4 rules to the embedded address
    return blocked.check(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, 'ipv4');
  }
  return blocked.check(g.map((x) => x.toString(16)).join(':'), 'ipv6');
}

/** Throws unless the URL is http(s) and every resolved address is public. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported protocol');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('Address not allowed');
  }
  return url;
}
