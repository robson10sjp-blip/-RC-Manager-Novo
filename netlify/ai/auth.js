import { createVerify } from "node:crypto";

const CERTIFICATES_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_SECONDS = 300;

export class AuthError extends Error {
  constructor(message = "invalid_token") {
    super(message);
    this.name = "AuthError";
  }
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new AuthError("malformed_token");
  }
}

export function createCertificateProvider(fetchImpl = fetch) {
  let cache = null;

  return async function getCertificates(nowMs = Date.now()) {
    if (cache && cache.expiresAt > nowMs) return cache.certificates;
    const response = await fetchImpl(CERTIFICATES_URL);
    if (!response.ok) throw new Error("certificates_unavailable");
    const certificates = await response.json();
    const maxAge = Number(
      /max-age=(\d+)/.exec(response.headers?.get?.("cache-control") || "")?.[1] ||
        3600
    );
    cache = { certificates, expiresAt: nowMs + maxAge * 1000 };
    return certificates;
  };
}

// Verifies a Firebase ID token locally (RS256 signature + standard claims).
export async function verifyFirebaseIdToken(
  token,
  { projectId, getCertificates, nowMs = Date.now() }
) {
  if (typeof token !== "string" || token.split(".").length !== 3) {
    throw new AuthError("malformed_token");
  }
  if (!projectId) throw new Error("project_not_configured");

  const [headerPart, payloadPart, signaturePart] = token.split(".");
  const header = decodePart(headerPart);
  const payload = decodePart(payloadPart);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AuthError("unsupported_token");
  }

  const certificates = await getCertificates(nowMs);
  const certificate = certificates?.[header.kid];
  if (!certificate) throw new AuthError("unknown_key");

  const signatureValid = createVerify("RSA-SHA256")
    .update(`${headerPart}.${payloadPart}`)
    .verify(certificate, Buffer.from(signaturePart, "base64url"));
  if (!signatureValid) throw new AuthError("bad_signature");

  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}` ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= nowSeconds ||
    !Number.isFinite(payload.iat) ||
    payload.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
    typeof payload.sub !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub)
  ) {
    throw new AuthError("invalid_claims");
  }

  return { uid: payload.sub };
}
