import { createCipheriv, createHmac } from "node:crypto";
import { decodeJwtPayload } from "./submit-signature.js";

/**
 * Pure-HTTP Unipus SSO (CAS) login.
 *
 * Flow (verified against the live service):
 *   1. GET  sso.unipus.cn/sso/login?service=...
 *   2. POST sso.unipus.cn/sso/0.1/sso/cip/login   (AES-encrypted credentials)
 *   3. GET  <service>?ticket=ST-...                (sets the `jwt` cookie)
 *   4. POST ucontent.unipus.cn/course/api/v3/ipublish/token
 *         headers: Authorization=<jwt cookie>, x-annotator-auth-token=<HS256(open_id)>
 *   5. Use `data.token` as `Bearer <token>` against ipub.unipus.cn
 */

const SSO_BASE = "https://sso.unipus.cn";
const UCONTENT_BASE = "https://ucontent.unipus.cn";

/** The login page encrypts credentials with AES-128-CBC and a fixed key/iv. */
const LOGIN_AES_KEY = Buffer.from(
  "8AD70B641C024C7ADA2ECD082EC0334F",
  "hex",
);
const LOGIN_AES_IV = Buffer.from("0102030405060708090A0B0C0D0E0F10", "hex");

/** Secret used by the reader shell to mint `x-annotator-auth-token`. */
const ANNOTATOR_SECRET = "a824b379f126b8b7aa5e33dee83fb0a05aa7462c";

export function encryptLoginField(value: string): string {
  const cipher = createCipheriv("aes-128-cbc", LOGIN_AES_KEY, LOGIN_AES_IV);
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
    .toString("hex")
    .toUpperCase();
}

export function signAnnotatorToken(
  openId: string,
  now = Date.now(),
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      open_id: openId,
      name: "",
      email: "",
      administrator: false,
      exp: now + 31536e6,
      iss: "c4f772063dcfa98e9c50",
      aud: "edx.unipus.cn",
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", ANNOTATOR_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Build the CAS service URL the reader shell would use. */
export function buildCasService(targetUrl: string): string {
  const withoutHash = targetUrl.split("#")[0]!;
  return `${UCONTENT_BASE}:443/cas-auth/login/?next=${encodeURIComponent(withoutHash)}`;
}

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export class CookieJar {
  private readonly cookies = new Map<string, CookieRecord>();

  store(url: string, setCookies: string[] | undefined): void {
    const host = new URL(url).hostname;
    for (const raw of setCookies ?? []) {
      const [pair = "", ...attributes] = raw.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const cookie: CookieRecord = {
        name: pair.slice(0, index).trim(),
        value: pair.slice(index + 1).trim(),
        domain: host,
        path: "/",
      };
      for (const attribute of attributes) {
        const [key = "", ...rest] = attribute.split("=");
        const name = key.trim().toLowerCase();
        const value = rest.join("=").trim();
        if (name === "domain" && value) cookie.domain = value;
        else if (name === "path" && value) cookie.path = value;
      }
      this.cookies.set(`${cookie.domain}\t${cookie.name}`, cookie);
      if (host.endsWith("unipus.cn")) {
        this.cookies.set(`.unipus.cn\t${cookie.name}`, {
          ...cookie,
          domain: ".unipus.cn",
        });
      }
    }
  }

  get(name: string, host?: string): string | undefined {
    if (host) {
      const exact = this.cookies.get(`${host}\t${name}`);
      if (exact) return exact.value;
    }
    for (const cookie of this.cookies.values()) {
      if (cookie.name === name) return cookie.value;
    }
    return undefined;
  }

  header(url: string): string {
    const host = new URL(url).hostname;
    const parts: string[] = [];
    for (const cookie of this.cookies.values()) {
      const domain = cookie.domain.replace(/^\./, "");
      if (host === domain || host.endsWith(`.${domain}`)) {
        parts.push(`${cookie.name}=${cookie.value}`);
      }
    }
    return parts.join("; ");
  }

  toObject(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const cookie of this.cookies.values()) {
      if (cookie.domain.startsWith(".")) out[cookie.name] = cookie.value;
    }
    return out;
  }
}

export interface CasLoginOptions {
  username: string;
  password: string;
  /** Reader page URL (hash is stripped). */
  targetUrl: string;
  courseId: string;
  fetcher?: typeof fetch;
  /** Injected for tests. */
  now?: number;
}

export interface CasLoginResult {
  token: string;
  tokenExpiresAt?: number;
  openId: string;
  cookies: Record<string, string>;
}

interface LoginResponse {
  code?: string;
  msg?: string;
  error?: string;
  rs?: {
    serviceTicket?: string;
    openid?: string;
    grantingTicket?: string;
  };
}

async function request(
  jar: CookieJar,
  fetcher: typeof fetch,
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  const cookie = jar.header(url);
  const response = await fetcher(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(options.body ? { body: options.body } : {}),
    redirect: "manual",
  });
  jar.store(url, response.headers.getSetCookie?.() ?? []);
  return response;
}

/**
 * Log in with a password and exchange the CAS ticket for a reader token.
 * Throws a descriptive error for captcha/MFA gates so the caller can surface it.
 */
export async function loginWithPassword(
  options: CasLoginOptions,
): Promise<CasLoginResult> {
  const fetcher = options.fetcher ?? fetch;
  const jar = new CookieJar();
  const service = buildCasService(options.targetUrl);
  const loginPage = `${SSO_BASE}/sso/login?service=${encodeURIComponent(service)}`;

  const page = await request(jar, fetcher, loginPage);
  await page.text().catch(() => "");

  const loginResponse = await request(jar, fetcher, `${SSO_BASE}/sso/0.1/sso/cip/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SSO_BASE,
      referer: loginPage,
    },
    body: JSON.stringify({
      username: encryptLoginField(options.username),
      password: encryptLoginField(options.password),
      service,
      pcFlag: true,
      bindFlag: true,
      mfaCode: "",
    }),
  });
  const loginText = await loginResponse.text();
  let login: LoginResponse;
  try {
    login = JSON.parse(loginText) as LoginResponse;
  } catch {
    throw new Error(`SSO login returned non-JSON (HTTP ${loginResponse.status})`);
  }
  if (login.code === "1506") {
    throw new Error("SSO requires a captcha; complete it once in a browser or retry later");
  }
  if (login.code !== "0") {
    throw new Error(
      `SSO login failed: code ${login.code ?? "?"} ${login.msg ?? login.error ?? ""}`.trim(),
    );
  }
  const ticket = login.rs?.serviceTicket;
  if (!ticket) throw new Error("SSO login returned no serviceTicket");

  // Redeem the ticket; this sets the `jwt` cookie on the ucontent domain.
  let current = service.includes("?")
    ? `${service}&ticket=${ticket}`
    : `${service}?ticket=${ticket}`;
  for (let hop = 0; hop < 8; hop += 1) {
    const response = await request(jar, fetcher, current);
    const location = response.headers.get("location");
    await response.text().catch(() => "");
    if (!location) break;
    current = new URL(location, current).toString();
    if (!current.includes("unipus.cn")) break;
  }

  const openId = login.rs?.openid ?? "";
  if (!openId) throw new Error("SSO login returned no openid");

  const jwt = jar.get("jwt", `${new URL(options.targetUrl).hostname}`);
  if (!jwt) throw new Error("SSO login did not set the jwt cookie");

  const tokenResponse = await request(jar, fetcher, `${UCONTENT_BASE}/course/api/v3/ipublish/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: UCONTENT_BASE,
      referer: options.targetUrl.split("#")[0]!,
      accept: "application/json, text/plain, */*",
      authorization: jwt,
      "x-annotator-auth-token": signAnnotatorToken(openId, options.now),
    },
    body: JSON.stringify({ courseId: options.courseId, readerType: 2 }),
  });
  const tokenText = await tokenResponse.text();
  if (!tokenResponse.ok) {
    throw new Error(
      `reader token request failed: HTTP ${tokenResponse.status} ${tokenText.slice(0, 160)}`,
    );
  }
  const payload = JSON.parse(tokenText) as {
    code?: number;
    message?: string;
    data?: { token?: string };
  };
  const token = payload.data?.token;
  if (payload.code !== 0 || !token) {
    throw new Error(
      `reader token rejected: ${payload.message ?? tokenText.slice(0, 160)}`,
    );
  }

  let tokenExpiresAt: number | undefined;
  try {
    const claims = decodeJwtPayload(token);
    if (typeof claims.exp === "number") tokenExpiresAt = claims.exp;
  } catch {
    // Token shape changed; keep the token and let the API reject it later.
  }

  return {
    token,
    ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
    openId,
    cookies: jar.toObject(),
  };
}

/** True when the token is missing or expires within `marginSeconds`. */
export function needsRefresh(
  record: { token?: string; tokenExpiresAt?: number },
  marginSeconds = 6 * 3600,
): boolean {
  if (!record.token) return true;
  if (!record.tokenExpiresAt) return false;
  return record.tokenExpiresAt - Math.floor(Date.now() / 1000) < marginSeconds;
}
