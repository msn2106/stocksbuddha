import { BlockList, isIP } from "node:net";
import type { Request } from "express";

/** Normalize socket and forwarded addresses, including IPv4-mapped loopback sockets. */
function normalize(address: string) {
  return address.startsWith("::ffff:") && isIP(address.slice(7)) === 4
    ? address.slice(7)
    : address;
}

/** Compile explicit proxy IPs/CIDRs; never trust arbitrary peers or hop counts. */
export function trustedProxies(value = "") {
  const list = new BlockList();
  for (const entry of value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const [raw, prefix, extra] = entry.split("/");
    const address = normalize(raw);
    const version = isIP(address);
    if (!version || extra !== undefined)
      throw new Error("AUTH_TRUSTED_PROXIES requires explicit IPs or CIDRs");
    const family = version === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(address, family);
    else {
      const bits = Number(prefix);
      if (
        !/^\d+$/.test(prefix) ||
        bits < 1 ||
        bits > (version === 4 ? 32 : 128)
      )
        throw new Error("Invalid trusted proxy CIDR");
      list.addSubnet(address, bits, family);
    }
  }
  return (address: string) => {
    const ip = normalize(address);
    return list.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
  };
}

/** Walk forwarded hops from the trusted socket inward; untrusted peers cannot supply identity headers. */
export function clientIp(req: Request, trusted: (address: string) => boolean) {
  const socket = normalize(req.socket.remoteAddress ?? "");
  if (!isIP(socket)) return "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if (!trusted(socket) || typeof forwarded !== "string") return socket;
  const hops = forwarded.split(",").map((hop) => normalize(hop.trim()));
  if (hops.length > 32 || hops.some((hop) => !isIP(hop))) return socket;
  let address = socket;
  for (const hop of hops.reverse()) {
    if (!trusted(address)) break;
    address = hop;
  }
  return address;
}
