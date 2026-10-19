import { isIP } from "node:net";
// Only exact proxy addresses are accepted. Trusting a subnet or a hop count lets
// sibling containers / alternate request paths invent a client identity.
export function trustedProxies(raw?: string) {
  if (!raw) return false;
  return raw.split(",").map((v) => {
    const value = v.trim(),
      [host, prefix, ...extra] = value.split("/");
    const version = isIP(host);
    if (
      !version ||
      extra.length ||
      (prefix !== undefined && prefix !== (version === 4 ? "32" : "128"))
    )
      throw new Error(
        "TRUSTED_PROXY_CIDRS must contain exact IP addresses (/32 or /128), not subnet/hop trust",
      );
    return value;
  });
}
