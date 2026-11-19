const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** True for the machine itself. */
function isLoopback(addr) {
  return LOOPBACK.has(addr);
}

/**
 * True for addresses on a private network: home or office LAN, link-local, carrier-grade NAT
 * (Tailscale and similar VPNs) and IPv6 unique-local / link-local. Public internet addresses
 * are never private.
 */
function isPrivateAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(addr);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([v4[1], v4[2], v4[3], v4[4]].some(n => Number(n) > 255)) return false;
    return a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127)
      || a === 127;
  }
  const v6 = addr.toLowerCase().split('%')[0]; // drop a zone id such as %eth0
  return v6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
}

module.exports = { isLoopback, isPrivateAddress };
