// src/module.ts
import { createCipheriv as createCipheriv2, createHmac as createHmac3 } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// src/vendor/submit-signature.ts
import { createHmac } from "node:crypto";
var PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43];
function primeSkip(key, length) {
  if (!key) throw new Error("primeSkip: empty key");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < length; index += 1) {
    offset = (offset + PRIMES[index % PRIMES.length]) % key.length;
    bytes[index] = key.charCodeAt(offset) + index & 255;
  }
  return bytes;
}
function hotpSha1(key, counter, modDivisor = 1e6) {
  const buffer = Buffer.alloc(8);
  let value = BigInt(Math.floor(counter));
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  const digest = createHmac("sha1", Buffer.from(key)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest[offset] & 127) << 24 | (digest[offset + 1] & 255) << 16 | (digest[offset + 2] & 255) << 8 | digest[offset + 3] & 255;
  return String(code % modDivisor).padStart(6, "0");
}
function buildSubmitSignature(input) {
  const openIdSum = input.openId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const keyLength = openIdSum % 10 + 4;
  const keyString = `${input.authorization}|${input.referer}`;
  const keyBytes = primeSkip(keyString, keyLength);
  return hotpSha1(keyBytes, input.timestamp);
}
function decodeJwtPayload(token) {
  const raw = token.replace(/^Bearer\s+/i, "").trim();
  const parts = raw.split(".");
  if (parts.length < 2) throw new Error("not a JWT");
  const payload = parts[1];
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  );
}
function readOpenId(token) {
  const payload = decodeJwtPayload(token);
  const openId = payload.openId ?? payload.sub ?? payload.boid;
  if (typeof openId !== "string" || !openId) {
    throw new Error("reader token has no openId/sub/boid");
  }
  return openId;
}

// src/vendor/chapter-api.ts
var DEFAULT_BASE_URL = "https://ipub.unipus.cn";
function authHeader(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}
function baseHeaders(token) {
  return {
    authorization: authHeader(token),
    lovefrom: "learner",
    accept: "application/json, text/plain, */*",
    "content-type": "application/json"
  };
}
function signedHeaders(token, referer, timestamp, openId) {
  const authorization = authHeader(token);
  const v = buildSubmitSignature({
    authorization,
    openId: openId ?? readOpenId(token),
    referer,
    timestamp
  });
  return {
    ...baseHeaders(token),
    "x-referer": referer,
    v
  };
}
function buildChapterReferer(ids) {
  return `https://ipub.unipus.cn/learner/textbook/book/${ids.bookId}/chapter/${ids.chapterId}?bookVersionNumber=${ids.bookVersionNumber}`;
}
async function postJson(options, path, meta, payload, fetcher) {
  const a = Number(payload.a ?? Date.now());
  const response = await fetcher(`${options.baseUrl ?? DEFAULT_BASE_URL}${path}`, {
    method: "POST",
    headers: signedHeaders(options.token, meta.referer, a, meta.openId),
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = void 0;
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
    ...json !== void 0 ? { json } : {},
    payload
  };
}
async function finishChapterNode(options, meta, node, fetcher = fetch) {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  return postJson(
    options,
    "/api/reader/action/finishNode",
    meta,
    {
      bookId: meta.bookId,
      bookVersionNumber: meta.bookVersionNumber,
      chapterId: meta.chapterId,
      chapterVersionNumber: meta.chapterVersionNumber,
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      a,
      b
    },
    fetcher
  );
}

// src/vendor/cas-login.ts
import { createCipheriv, createHmac as createHmac2 } from "node:crypto";
var LOGIN_AES_KEY = Buffer.from(
  "8AD70B641C024C7ADA2ECD082EC0334F",
  "hex"
);
var LOGIN_AES_IV = Buffer.from("0102030405060708090A0B0C0D0E0F10", "hex");
var ANNOTATOR_SECRET = "a824b379f126b8b7aa5e33dee83fb0a05aa7462c";
function signAnnotatorToken(openId, now = Date.now()) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      open_id: openId,
      name: "",
      email: "",
      administrator: false,
      exp: now + 31536e6,
      iss: "c4f772063dcfa98e9c50",
      aud: "edx.unipus.cn"
    })
  ).toString("base64url");
  const signature = createHmac2("sha256", ANNOTATOR_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

// src/vendor/video.ts
var DEFAULT_CONTENT_BASE_URL = "https://ucontent.unipus.cn";
var DEFAULT_READER_BASE_URL = "https://ipub.unipus.cn";
function authHeaderValue(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}
function rawToken(token) {
  return token.replace(/^Bearer\s+/i, "").trim();
}
async function fetchCourseTree(options, fetcher = fetch) {
  const base = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const response = await fetcher(
    `${base}/course/api/course/${options.courseId}/default`,
    {
      headers: {
        cookie: options.cookie,
        authorization: rawToken(options.token),
        accept: "application/json"
      }
    }
  );
  const text = await response.text();
  const json = JSON.parse(text);
  if (json.course) {
    const parsed = JSON.parse(json.course);
    return Array.isArray(parsed) ? parsed : parsed.units ?? [];
  }
  throw new Error(`fetchCourseTree: ${json.msg ?? `code ${json.code}`}`);
}
async function fetchUnitProgress(options, fetcher = fetch) {
  const base = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const response = await fetcher(
    `${base}/course/api/v2/course_progress/${options.courseId}/${options.unit}/${options.openId}/default`,
    {
      headers: {
        cookie: options.cookie,
        authorization: rawToken(options.token),
        "x-annotator-auth-token": signAnnotatorToken(options.openId),
        accept: "application/json"
      }
    }
  );
  const json = await response.json();
  if (!json.rt) throw new Error(`fetchUnitProgress: ${json.msg ?? `code ${json.code}`}`);
  const leafs = {};
  for (const [id, leaf] of Object.entries(json.rt.leafs ?? {})) {
    leafs[id] = {
      ...leaf.state?.pass !== void 0 ? { pass: leaf.state.pass } : {},
      ...leaf.state?.pass2 !== void 0 ? { pass2: leaf.state.pass2 } : {}
    };
  }
  return leafs;
}
async function fetchVideoDurations(options, fetcher = fetch) {
  const base = options.baseUrl ?? DEFAULT_READER_BASE_URL;
  const response = await fetcher(
    `${base}/api/reader/chapter/getBookResource?bookId=${encodeURIComponent(options.bookId)}&bookVersionNumber=${encodeURIComponent(options.bookVersionNumber)}`,
    {
      headers: {
        authorization: authHeaderValue(options.token),
        lovefrom: "learner",
        accept: "application/json"
      }
    }
  );
  const json = await response.json();
  if (!json.data?.resourceList) {
    throw new Error(`fetchVideoDurations: ${json.message ?? `code ${json.code}`}`);
  }
  const durations = /* @__PURE__ */ new Map();
  for (const entry of json.data.resourceList) {
    const chapterId = entry.chapterId;
    if (!chapterId || !entry.resource) continue;
    let parsed;
    try {
      parsed = JSON.parse(entry.resource);
    } catch {
      continue;
    }
    for (const item of parsed.resources ?? []) {
      const resource = typeof item === "string" ? safeJson(item) : item;
      if (!resource || resource.type !== "insert-video") continue;
      const anchor = resource.$?.__anchor__;
      const rawDuration = resource.mediaFile?.duration;
      const durationMs = Number(rawDuration);
      if (typeof anchor !== "string" || !Number.isFinite(durationMs) || durationMs <= 0) {
        continue;
      }
      durations.set(anchor, {
        chapterId,
        durationMs,
        ...resource.mediaFile?.mediaName ? { name: String(resource.mediaFile.mediaName) } : {}
      });
    }
  }
  return durations;
}
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
async function markVideoWatched(options, video, fetcher = fetch) {
  const now = Date.now();
  const dwell = video.durationMs + (video.extraMs ?? 1e3);
  const referer = buildChapterReferer({
    bookId: video.bookId,
    bookVersionNumber: video.bookVersionNumber,
    chapterId: video.chapterId
  });
  return finishChapterNode(
    options,
    {
      bookId: video.bookId,
      bookVersionNumber: video.bookVersionNumber,
      chapterId: video.chapterId,
      chapterVersionNumber: video.chapterVersionNumber,
      referer,
      timestamp: now - dwell,
      endTimestamp: now
    },
    { nodeId: video.anchor, nodeType: "insert-video" },
    fetcher
  );
}

// src/vendor/reading.ts
var TEXT_LEAF_BASES = [
  "base-paragraph",
  "list",
  "collapsible-block",
  "rich_text_read"
];
async function markNodeRead(options, node, fetcher = fetch) {
  const now = Date.now();
  const dwell = Math.max(1e3, node.dwellMs);
  const nodeType = node.nodeType === "rich_text_read" ? "question-block" : node.nodeType;
  return finishChapterNode(
    options,
    {
      bookId: node.bookId,
      bookVersionNumber: node.bookVersionNumber,
      chapterId: node.chapterId,
      chapterVersionNumber: node.chapterVersionNumber,
      referer: buildChapterReferer({
        bookId: node.bookId,
        bookVersionNumber: node.bookVersionNumber,
        chapterId: node.chapterId
      }),
      timestamp: now - dwell,
      endTimestamp: now
    },
    { nodeId: node.anchor, nodeType },
    fetcher
  );
}

// src/module.ts
var MANIFEST = JSON.parse(
  readFileSync(new URL("./courseflow.module.json", import.meta.url), "utf8")
);
var SETTINGS = (() => {
  try {
    const parsed = JSON.parse(process.env.CF_MODULE_SETTINGS || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
})();
var SOURCE = SETTINGS.source === "live" ? "live" : "fixture";
var TARGET_URL = typeof SETTINGS.target_url === "string" ? SETTINGS.target_url : "https://ucontent.unipus.cn/_ipublishpc_default/pc.html";
var COURSE_ID = typeof SETTINGS.course_id === "string" ? SETTINGS.course_id : "";
var COURSE_NAME = typeof SETTINGS.course_name === "string" && SETTINGS.course_name.trim() ? SETTINGS.course_name.trim() : "U\u6821\u56ED\u8BFE\u7A0B";
var BOOK_ID = typeof SETTINGS.book_id === "string" ? SETTINGS.book_id : "";
var BOOK_VERSION = typeof SETTINGS.book_version === "string" ? SETTINGS.book_version : "";
var IPUB_BASE = typeof SETTINGS.base_url === "string" && SETTINGS.base_url.trim() ? SETTINGS.base_url.trim() : "https://ipub.unipus.cn";
var CONTENT_BASE = typeof SETTINGS.content_base_url === "string" && SETTINGS.content_base_url.trim() ? SETTINGS.content_base_url.trim() : "https://ucontent.unipus.cn";
var SSO_BASE = "https://sso.unipus.cn";
var UCONTENT_BASE = "https://ucontent.unipus.cn";
var LOGIN_AES_KEY2 = Buffer.from("8AD70B641C024C7ADA2ECD082EC0334F", "hex");
var LOGIN_AES_IV2 = Buffer.from("0102030405060708090A0B0C0D0E0F10", "hex");
var ANNOTATOR_SECRET2 = "a824b379f126b8b7aa5e33dee83fb0a05aa7462c";
var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
var BROWSER_HEADERS = {
  "user-agent": BROWSER_UA,
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"'
};
var write = (message) => process.stdout.write(`${JSON.stringify(message)}
`);
var log = (level, message) => process.stderr.write(`[unipus] ${level} ${message}
`);
var nextId = 1;
var pending = /* @__PURE__ */ new Map();
function hostCall(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  write({ jsonrpc: "2.0", id, method, params });
  return promise;
}
function errorText(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  return String(error);
}
function encryptLoginField(value) {
  const cipher = createCipheriv2("aes-128-cbc", LOGIN_AES_KEY2, LOGIN_AES_IV2);
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("hex").toUpperCase();
}
function signAnnotatorToken2(openId, now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      open_id: openId,
      name: "",
      email: "",
      administrator: false,
      exp: now + 31536e6,
      iss: "c4f772063dcfa98e9c50",
      aud: "edx.unipus.cn"
    })
  ).toString("base64url");
  const signature = createHmac3("sha256", ANNOTATOR_SECRET2).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
function buildCasService(targetUrl) {
  const withoutHash = targetUrl.split("#")[0];
  return `${UCONTENT_BASE}:443/cas-auth/login/?next=${encodeURIComponent(withoutHash)}`;
}
function decodeJwtExpiry(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp : void 0;
  } catch {
    return void 0;
  }
}
var challenges = /* @__PURE__ */ new Map();
var challengeSeq = 0;
async function describe(params) {
  log("info", `describe framework=${params.framework_version ?? ""} source=${SOURCE}`);
  return {
    module: { name: "courseflow-unipus", version: MANIFEST.version, module_api: 1 },
    platform: MANIFEST.platform
  };
}
function placeholderQr() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><text x="80" y="78" font-size="13" text-anchor="middle" fill="#111">U\u6821\u56ED\u9AA8\u67B6</text><text x="80" y="96" font-size="11" text-anchor="middle" fill="#666">\u8BF7\u4F7F\u7528\u8D26\u53F7\u5BC6\u7801\u767B\u5F55</text></svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
function authBegin(params) {
  challengeSeq += 1;
  const id = String(params.session ?? `ch_unipus_${challengeSeq}_${Date.now()}`);
  const method = params.method === "qr" ? "qr" : "password";
  challenges.set(id, { method, state: "waiting", at: Date.now() });
  log("info", `auth.begin method=${method} challenge=${id}`);
  if (method === "qr") {
    return {
      challenge: {
        id,
        kind: "qr",
        image: placeholderQr(),
        expires_at: Math.floor(Date.now() / 1e3) + 180
      }
    };
  }
  return {
    challenge: {
      id,
      kind: "password",
      expires_at: Math.floor(Date.now() / 1e3) + 180,
      fields: [
        {
          name: "username",
          label: "U\u6821\u56ED\u8D26\u53F7",
          type: "text",
          required: true,
          autocomplete: "username",
          placeholder: "\u624B\u673A\u53F7\u6216\u90AE\u7BB1"
        },
        {
          name: "password",
          label: "\u5BC6\u7801",
          type: "password",
          required: true,
          autocomplete: "current-password"
        }
      ]
    }
  };
}
async function liveLogin(session, username, password) {
  const service = buildCasService(TARGET_URL);
  const loginPage = `${SSO_BASE}/sso/login?service=${encodeURIComponent(service)}`;
  await hostCall("cw.net.fetch", {
    session,
    method: "GET",
    url: loginPage,
    stage: "read",
    headers: {
      ...BROWSER_HEADERS,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const loginResponse = await hostCall("cw.net.fetch", {
    session,
    method: "POST",
    url: `${SSO_BASE}/sso/0.1/sso/cip/login`,
    encoding: "json",
    stage: "read",
    headers: {
      ...BROWSER_HEADERS,
      origin: SSO_BASE,
      referer: loginPage,
      accept: "application/json, text/plain, */*"
    },
    body: {
      username: encryptLoginField(username),
      password: encryptLoginField(password),
      service,
      pcFlag: true,
      bindFlag: true,
      mfaCode: ""
    }
  });
  let login;
  try {
    login = JSON.parse(loginResponse.body);
  } catch {
    throw new Error(`SSO \u8FD4\u56DE\u975E JSON\uFF08HTTP ${loginResponse.status}\uFF09`);
  }
  if (login.code === "1506") throw new Error("\u5E73\u53F0\u8981\u6C42\u9A8C\u8BC1\u7801\uFF0C\u8BF7\u5148\u5728\u6D4F\u89C8\u5668\u5B8C\u6210\u4E00\u6B21\u767B\u5F55\u6216\u7A0D\u540E\u91CD\u8BD5");
  if (login.code !== "0") {
    throw new Error(`SSO \u767B\u5F55\u5931\u8D25\uFF1Acode ${login.code ?? "?"} ${login.msg ?? login.error ?? ""}`.trim());
  }
  const ticket = login.rs?.serviceTicket;
  const openId = login.rs?.openid;
  if (!ticket) throw new Error("SSO \u672A\u8FD4\u56DE serviceTicket");
  if (!openId) throw new Error("SSO \u672A\u8FD4\u56DE openid");
  const redeem = service.includes("?") ? `${service}&ticket=${ticket}` : `${service}?ticket=${ticket}`;
  try {
    await hostCall("cw.net.fetch", {
      session,
      method: "GET",
      url: redeem,
      stage: "read",
      headers: {
        ...BROWSER_HEADERS,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } catch (error) {
    if (error?.code !== "platform_verification_required") throw error;
    log("warn", "ticket redeem returned 403; continuing with captured cookies");
  }
  if (!COURSE_ID) {
    throw new Error("live \u6A21\u5F0F\u9700\u8981\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u63D0\u4F9B course_id\uFF08reader token \u4EA4\u6362\u7528\uFF09");
  }
  const annotator = signAnnotatorToken2(openId);
  let page;
  try {
    const opened = await hostCall("cw.browser.open", {
      session,
      url: TARGET_URL,
      purpose: "reader-token"
    });
    page = opened?.page;
    if (!page) throw new Error("\u5B98\u65B9\u6D4F\u89C8\u5668\u6CA1\u6709\u8FD4\u56DE\u9875\u9762\u53E5\u67C4");
    const expression = `(async () => {
      const res = await fetch('/course/api/v3/ipublish/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/plain, */*',
          'x-annotator-auth-token': ${JSON.stringify(annotator)}
        },
        credentials: 'include',
        body: JSON.stringify({ courseId: ${JSON.stringify(COURSE_ID)}, readerType: 2 })
      });
      const text = await res.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch {}
      return {
        href: location.href,
        status: res.status,
        code: payload?.code ?? 'non-json',
        token: payload?.data?.token ?? null,
        message: payload?.message ?? text.slice(0, 160)
      };
    })()`;
    let result = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      result = await hostCall("cw.browser.evaluate", {
        session,
        page,
        expression,
        stage: "read"
      });
      if (result && result.loading !== true) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!result || result.loading === true) {
      throw new Error("\u5B98\u65B9\u9875\u9762\u5C1A\u672A\u5C31\u7EEA\uFF0C\u65E0\u6CD5\u4EA4\u6362 reader token");
    }
    if (result.status !== 200 || !result.token) {
      throw new Error(`reader token \u6D4F\u89C8\u5668\u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${result.status} @ ${result.href ?? ""} ${result.message ?? ""}`.trim());
    }
    return {
      token: result.token,
      openId,
      expiresAt: decodeJwtExpiry(result.token),
      displayName: username
    };
  } finally {
    if (page) {
      await hostCall("cw.browser.close", { session, page }).catch(() => {
      });
    }
  }
}
async function authSubmit(params) {
  const id = String(params.challenge ?? "");
  const challenge = challenges.get(id);
  if (!challenge) return { state: "expired" };
  const fields = params.fields && typeof params.fields === "object" ? params.fields : {};
  const username = typeof fields.username === "string" ? fields.username.trim() : "";
  const password = typeof fields.password === "string" ? fields.password : "";
  if (!username || !password) {
    return { state: "failed", message: "\u8BF7\u8F93\u5165\u8D26\u53F7\u548C\u5BC6\u7801" };
  }
  log("info", `auth.submit mode=${SOURCE} challenge=${id}`);
  try {
    let identity;
    if (SOURCE === "fixture") {
      identity = {
        token: "fixture-reader-token",
        openId: "unipus-fixture",
        displayName: "U\u6821\u56ED\uFF08\u79BB\u7EBF\uFF09",
        expiresAt: void 0
      };
    } else {
      identity = await liveLogin(id, username, password);
    }
    challenge.state = "connected";
    challenge.identity = {
      display_name: identity.displayName,
      account_raw: identity.openId
    };
    challenge.token = identity.token;
    await hostCall("cw.state", {
      session: id,
      namespace: "auth",
      key: "session",
      value: {
        token: identity.token,
        open_id: identity.openId,
        expires_at: identity.expiresAt ?? null,
        source: SOURCE,
        connected_at: Date.now()
      }
    });
    log("info", `auth.submit connected source=${SOURCE}`);
    return { state: "connected" };
  } catch (error) {
    const message = errorText(error);
    challenge.state = "failed";
    challenge.message = message;
    log("warn", `auth.submit failed: ${message}`);
    return { state: "failed", message };
  }
}
function authPoll(params) {
  const challenge = challenges.get(String(params.challenge ?? ""));
  if (!challenge) return { state: "expired" };
  return { state: challenge.state };
}
function authComplete(params) {
  const id = String(params.challenge ?? "");
  const challenge = challenges.get(id);
  if (!challenge) throw { code: "invalid_params", message: "\u767B\u5F55\u6311\u6218\u4E0D\u5B58\u5728" };
  const identity = challenge.identity;
  challenges.delete(id);
  if (!identity) throw { code: "invalid_params", message: "\u767B\u5F55\u5C1A\u672A\u5B8C\u6210" };
  return identity;
}
async function authVerify(params) {
  try {
    const identity = await hostCall("cw.session.identity", { session: params.session });
    return {
      display_name: identity?.display_name ?? "U\u6821\u56ED",
      account_raw: identity?.account_raw ?? "",
      connected_at: identity?.connected_at ?? null
    };
  } catch {
    return { display_name: "U\u6821\u56ED", account_raw: "" };
  }
}
async function authKeepalive(params) {
  if (SOURCE === "fixture") return { ok: true, mode: SOURCE };
  try {
    const state = await hostCall("cw.state", {
      session: params.session,
      namespace: "auth",
      key: "session"
    });
    if (!state?.value?.token) return { ok: false, reason: "no-token" };
    return { ok: true, mode: SOURCE, expires_at: state.value.expires_at ?? null };
  } catch (error) {
    return { ok: false, reason: error.message ?? "state-unavailable" };
  }
}
var HostResponse = class {
  status;
  ok;
  body;
  headers;
  constructor(response) {
    this.status = Number(response?.status ?? 0);
    this.ok = this.status >= 200 && this.status < 300;
    this.body = typeof response?.body === "string" ? response.body : "";
    const raw = response?.headers ?? {};
    const lower = /* @__PURE__ */ new Map();
    for (const [key, value] of Object.entries(raw)) lower.set(String(key).toLowerCase(), String(value));
    this.headers = { get: (name) => lower.get(String(name).toLowerCase()) ?? null };
  }
  async text() {
    return this.body;
  }
  async json() {
    return JSON.parse(this.body);
  }
};
function hostFetchFor(session) {
  return async (input, init = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    delete headers.cookie;
    delete headers.host;
    delete headers["content-length"];
    const rawBody = init.body;
    const body = rawBody === void 0 || rawBody === null ? void 0 : typeof rawBody === "string" ? rawBody : String(rawBody);
    const stage = /\/api\/reader\/action\/finishNode|\/api\/reader\/answer\/submitScore/.test(url) ? "save_study" : "read";
    const response = await hostCall("cw.net.fetch", {
      session,
      method: String(init.method ?? "GET").toUpperCase(),
      url,
      headers,
      ...body !== void 0 ? { body, encoding: "raw" } : {},
      stage
    });
    return new HostResponse(response);
  };
}
function authHeader2(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}
function baseHeaders2(token) {
  return {
    authorization: authHeader2(token),
    lovefrom: "learner",
    accept: "application/json, text/plain, */*"
  };
}
async function readAuth(session) {
  const stored = await hostCall("cw.state", { session, namespace: "auth", key: "session" });
  const value = stored?.value;
  if (!value?.token) throw { code: "platform_login_expired", message: "\u8BF7\u5148\u8FDE\u63A5 U\u6821\u56ED" };
  return value;
}
function courseConfig() {
  if (!COURSE_ID || !BOOK_ID || !BOOK_VERSION) return null;
  return { id: COURSE_ID, name: COURSE_NAME, bookId: BOOK_ID, bookVersion: BOOK_VERSION };
}
function treeUnitNumber(treeUnit, index) {
  const digits = String(treeUnit?.id ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : index + 1;
}
function chapterForUnit(treeUnit, chapters, index) {
  const number = treeUnitNumber(treeUnit, index);
  return chapters.find((chapter) => Number(chapter?.chapterNumber) === number) ?? chapters[index] ?? null;
}
function walkGroups(unit, group, visit) {
  visit(unit, group);
  for (const child of group?.children ?? []) walkGroups(unit, child, visit);
}
function findGroup(units, groupId) {
  let found = null;
  for (const unit of units) {
    for (const child of unit?.children ?? []) {
      walkGroups(unit, child, (owner, group) => {
        if (!found && String(group?.id ?? "") === groupId) found = { unit: owner, group };
      });
    }
  }
  return found;
}
async function fetchChapterList(fetcher, token, cfg) {
  const url = `${IPUB_BASE}/api/reader/chapter/getChapterList?bookId=${encodeURIComponent(cfg.bookId)}&bookVersionNumber=${encodeURIComponent(cfg.bookVersion)}`;
  const response = await fetcher(url, { headers: baseHeaders2(token) });
  const json = await response.json();
  return Array.isArray(json?.data?.chapterList) ? json.data.chapterList : [];
}
async function fetchChapterVersion(fetcher, token, cfg, chapterId) {
  const url = `${IPUB_BASE}/api/reader/chapter/getChapterInfo?bookId=${encodeURIComponent(cfg.bookId)}&bookVersionNumber=${encodeURIComponent(cfg.bookVersion)}&chapterId=${encodeURIComponent(chapterId)}`;
  const response = await fetcher(url, { headers: baseHeaders2(token) });
  const json = await response.json();
  const data = json?.data ?? {};
  let version = data.versionNumber ? String(data.versionNumber) : void 0;
  if (!version && typeof data.content === "string") {
    const match = data.content.match(/\/([^/]+)\/studentContent\.json/);
    if (match) version = match[1];
  }
  if (!version) throw new Error(`\u65E0\u6CD5\u89E3\u6790 chapterVersionNumber\uFF08chapter ${chapterId}\uFF09`);
  return version;
}
function isVideoGroup(base) {
  return base === "insert-video";
}
function isTextGroup(base) {
  return TEXT_LEAF_BASES.includes(base);
}
async function catalogCourses(params) {
  const session = String(params.session ?? "");
  if (SOURCE === "live") {
    const cfg = courseConfig();
    if (!cfg) {
      throw {
        code: "invalid_params",
        message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version"
      };
    }
    await readAuth(session);
    return {
      courses: [
        {
          id: cfg.id,
          recruit_id: cfg.id,
          name: cfg.name,
          kind: "shared",
          kind_label: "\u5171\u4EAB\u8BFE",
          family: "shared",
          progress: null,
          outline_available: true
        }
      ]
    };
  }
  return {
    courses: [
      {
        id: "unipus-demo",
        recruit_id: "unipus-demo-class",
        name: "U\u6821\u56ED\uFF08\u9AA8\u67B6\u8BFE\u7A0B\uFF09",
        kind: "shared",
        kind_label: "\u5171\u4EAB\u8BFE",
        family: "shared",
        progress: 0,
        outline_available: true
      }
    ]
  };
}
async function catalogUnits(params) {
  if (SOURCE !== "live") {
    if (params.course?.id !== "unipus-demo") return { units: [] };
    return {
      units: [
        {
          id: "unipus-demo-u1",
          name: "\u7B2C 1 \u7AE0 \xB7 \u9AA8\u67B6\u5355\u5143",
          chapter_id: "unipus-demo-c1",
          chapter_name: "\u7B2C 1 \u7AE0",
          lesson_id: "unipus-demo-l1",
          kind: "video",
          duration_seconds: 60,
          watched_seconds: 0,
          state: "not_started",
          video_id: "unipus-demo-v1",
          selectable: true
        },
        {
          id: "unipus-demo-u2",
          name: "\u7B2C 1 \u7AE0 \xB7 \u9605\u8BFB\u9AA8\u67B6",
          chapter_id: "unipus-demo-c1",
          chapter_name: "\u7B2C 1 \u7AE0",
          lesson_id: "unipus-demo-l2",
          kind: "reading",
          duration_seconds: 0,
          watched_seconds: 0,
          state: "not_started",
          video_id: null,
          selectable: true
        }
      ]
    };
  }
  const session = String(params.session ?? "");
  const cfg = courseConfig();
  if (!cfg) {
    throw {
      code: "invalid_params",
      message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version"
    };
  }
  if (params.course?.id !== cfg.id) throw { code: "not_found", message: "\u8BFE\u7A0B\u4E0D\u5B58\u5728" };
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: "", courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher
  );
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);
  let durations = /* @__PURE__ */ new Map();
  try {
    durations = await fetchVideoDurations(
      {
        token: auth.token,
        baseUrl: IPUB_BASE,
        bookId: cfg.bookId,
        bookVersionNumber: cfg.bookVersion
      },
      fetcher
    );
  } catch (error) {
    log("warn", `video durations failed: ${errorText(error)}`);
  }
  const units = [];
  for (let index = 0; index < tree.length; index += 1) {
    const treeUnit = tree[index];
    const chapter = chapterForUnit(treeUnit, chapters, index);
    const chapterId = chapter?.id ? String(chapter.id) : "";
    const chapterName = String(treeUnit?.name ?? chapter?.name ?? "");
    let progress = {};
    try {
      progress = await fetchUnitProgress(
        {
          token: auth.token,
          cookie: "",
          courseId: cfg.id,
          unit: String(treeUnit.id),
          openId: auth.open_id,
          baseUrl: CONTENT_BASE
        },
        fetcher
      );
    } catch (error) {
      log("warn", `progress ${treeUnit.id} failed: ${errorText(error)}`);
    }
    for (const child of treeUnit?.children ?? []) {
      walkGroups(treeUnit, child, (owner, group) => {
        const base = String(group?.base ?? "");
        const anchor = String(group?.externalNodeId ?? "");
        if (!anchor) return;
        if (!isVideoGroup(base) && !isTextGroup(base)) return;
        const kind = isVideoGroup(base) ? "video" : "reading";
        const durationMs = isVideoGroup(base) ? Number(durations.get(anchor)?.durationMs ?? 0) : 0;
        const pass = Number(progress?.[group.id]?.pass ?? 0);
        units.push({
          id: `${group.id}::${base}`,
          name: String(group.name ?? (kind === "video" ? "\u89C6\u9891" : "\u9605\u8BFB")).trim(),
          chapter_id: chapterId,
          chapter_name: chapterName,
          lesson_id: String(owner?.id ?? ""),
          kind,
          duration_seconds: durationMs > 0 ? Math.round(durationMs / 1e3) : 0,
          watched_seconds: 0,
          state: pass === 1 ? "completed" : "not_started",
          video_id: kind === "video" ? anchor : null,
          selectable: true
        });
      });
    }
  }
  log("info", `catalog.units course=${cfg.id} units=${units.length}`);
  return { units };
}
async function studyStep(params) {
  if (SOURCE !== "live") {
    const unit2 = params.unit ?? {};
    const duration = Number(unit2.duration_seconds ?? 60);
    const current = Number(params.checkpoint?.seconds ?? 0);
    const next = Math.min(duration, current + 30);
    if (duration === 0 || next >= duration) {
      return {
        status: "completed",
        evidence: { watched_seconds: next, stub: true },
        checkpoint: { seconds: next }
      };
    }
    return {
      status: "in_progress",
      progress: { watched_seconds: next },
      wait_ms: 300,
      checkpoint: { seconds: next }
    };
  }
  const session = String(params.session ?? "");
  const cfg = courseConfig();
  if (!cfg) {
    throw {
      code: "invalid_params",
      message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version"
    };
  }
  const unit = params.unit ?? {};
  const rawId = String(unit.id ?? "");
  const groupId = rawId.split("::")[0];
  if (!groupId) throw { code: "invalid_params", message: "\u7F3A\u5C11\u5355\u5143 id" };
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: "", courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher
  );
  const found = findGroup(tree, groupId);
  if (!found) throw { code: "not_found", message: "\u8BFE\u7A0B\u6811\u91CC\u627E\u4E0D\u5230\u8BE5\u5355\u5143" };
  const base = String(found.group.base ?? unit.lesson_id ?? "");
  const anchor = String(found.group.externalNodeId ?? unit.video_id ?? "");
  if (!anchor) throw { code: "invalid_params", message: "\u5355\u5143\u7F3A\u5C11 anchor" };
  const index = Math.max(0, tree.indexOf(found.unit));
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);
  const chapter = chapterForUnit(found.unit, chapters, index);
  if (!chapter?.id) throw { code: "not_found", message: "\u627E\u4E0D\u5230\u5BF9\u5E94\u7AE0\u8282" };
  const chapterId = String(chapter.id);
  const chapterVersion = await fetchChapterVersion(fetcher, auth.token, cfg, chapterId);
  if (params.checkpoint?.phase !== "submitted") {
    if (isVideoGroup(base)) {
      let durations = /* @__PURE__ */ new Map();
      try {
        durations = await fetchVideoDurations(
          {
            token: auth.token,
            baseUrl: IPUB_BASE,
            bookId: cfg.bookId,
            bookVersionNumber: cfg.bookVersion
          },
          fetcher
        );
      } catch (error) {
        log("warn", `video durations failed: ${errorText(error)}`);
      }
      const durationMs = Number(durations.get(anchor)?.durationMs ?? 0);
      if (!durationMs) {
        return {
          status: "unknown",
          reason: "\u65E0\u6CD5\u83B7\u53D6\u89C6\u9891\u65F6\u957F",
          checkpoint: { phase: "submitted" }
        };
      }
      const result = await markVideoWatched(
        { token: auth.token, baseUrl: IPUB_BASE },
        {
          chapterId,
          chapterVersionNumber: chapterVersion,
          bookId: cfg.bookId,
          bookVersionNumber: cfg.bookVersion,
          anchor,
          durationMs
        },
        fetcher
      );
      log(
        "info",
        `finishNode video ${anchor} HTTP ${result.status} code ${result.json?.code ?? "?"}`
      );
    } else if (isTextGroup(base)) {
      const result = await markNodeRead(
        { token: auth.token, baseUrl: IPUB_BASE },
        {
          bookId: cfg.bookId,
          bookVersionNumber: cfg.bookVersion,
          chapterId,
          chapterVersionNumber: chapterVersion,
          anchor,
          nodeType: base,
          dwellMs: 6e4
        },
        fetcher
      );
      log(
        "info",
        `finishNode text ${anchor} type ${base} HTTP ${result.status} code ${result.json?.code ?? "?"}`
      );
    } else {
      return { status: "needs_human", reason: `\u672A\u652F\u6301\u7684\u7C7B\u578B ${base}` };
    }
  }
  const leafs = await fetchUnitProgress(
    {
      token: auth.token,
      cookie: "",
      courseId: cfg.id,
      unit: String(found.unit.id),
      openId: auth.open_id,
      baseUrl: CONTENT_BASE
    },
    fetcher
  );
  const pass = Number(leafs?.[groupId]?.pass ?? 0);
  if (pass === 1) {
    return {
      status: "completed",
      evidence: { platform_confirmed: true, pass },
      checkpoint: { phase: "done" }
    };
  }
  return {
    status: "in_progress",
    wait_ms: 2e3,
    checkpoint: { phase: "submitted" }
  };
}
async function dispatch(method, params) {
  switch (method) {
    case "platform.describe":
      return describe(params);
    case "auth.begin":
      return authBegin(params);
    case "auth.submit":
      return authSubmit(params);
    case "auth.poll":
      return authPoll(params);
    case "auth.complete":
      return authComplete(params);
    case "auth.verify":
      return authVerify(params);
    case "auth.keepalive":
      return authKeepalive(params);
    case "catalog.courses":
      return catalogCourses(params);
    case "catalog.units":
      return catalogUnits(params);
    case "study.step":
      return studyStep(params);
    default:
      throw { code: "unsupported_operation", message: `U\u6821\u56ED\u9AA8\u67B6\u672A\u5B9E\u73B0 ${method}` };
  }
}
async function handleRequest(request) {
  try {
    const result = await dispatch(request.method, request.params ?? {});
    write({ jsonrpc: "2.0", id: request.id, result: result ?? {} });
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: error?.code ?? "module_error",
        message: error?.message ?? String(error)
      }
    });
  }
}
var lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    log("warn", "ignored non-JSON input");
    return;
  }
  if (message.id !== void 0 && (message.result !== void 0 || message.error !== void 0)) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(message.error);
    else waiter.resolve(message.result);
    return;
  }
  if (typeof message.method === "string" && message.id !== void 0) {
    void handleRequest(message);
  }
});
lines.on("close", () => {
  process.exit(0);
});
