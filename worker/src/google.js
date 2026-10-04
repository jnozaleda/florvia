// Verifies a Google «ID token» (the credential «Continuar con Google» returns): RS256 signature against
// Google's public keys, issuer, audience (our own client id) and expiry. Resolves to the account's
// stable id (`sub`), or null when anything is off. Nothing else from the token is read or kept.
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export async function verifyGoogleToken(token, clientId, getJwks, now = Date.now()) {
  if (typeof token !== "string" || token.length > 4096 || !clientId) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(b64(parts[1])));
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const jwk = (await getJwks()).keys?.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { ...jwk, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    if (!ISSUERS.includes(claims.iss) || claims.aud !== clientId) return null;
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 < now) return null;
    return typeof claims.sub === "string" && claims.sub.length > 0 && claims.sub.length <= 64 ? claims.sub : null;
  } catch { return null; }
}
