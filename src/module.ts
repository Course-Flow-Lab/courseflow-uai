/**
 * Courseflow U校园模块骨架 (moduleApi 1).
 *
 * 当前阶段：
 *   - platform.describe
 *   - auth.begin / auth.submit / auth.poll / auth.complete / auth.verify / auth.keepalive
 *   - catalog.courses / catalog.units
 *   - study.step
 *   - 宿主服务冒烟：cw.net.fetch / cw.state / cw.session.identity / cw.log
 *
 * 登录：
 *   - source=fixture（默认）：离线桩，任意账号密码都直接 connected，用于验证框架。
 *   - source=live：真实 CAS 密码登录 + reader token 交换。
 *     live 需要在模块设置里提供 course_id（reader token 交换用）。
 *
 * 尚未实现：真实课程目录、章节/视频/阅读协议、考试。live 模式下 study.step 返回 needs_human。
 */
import { createCipheriv, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  fetchCourseTree,
  fetchUnitProgress,
  fetchVideoDurations,
  markVideoWatched,
} from './vendor/video.js';
import { markNodeRead, TEXT_LEAF_BASES } from './vendor/reading.js';
import {
  buildChapterReferer,
  buildChapterSubmissions,
  fetchChapterAnswerList,
  fetchChapterStructure,
  submitChapterJudge,
  submitChapterScore,
} from './vendor/chapter-api.js';
import {
  buildPaperAnswerMap,
  buildPaperSavePayload,
  buildPaperSubmitPayload,
} from './vendor/paper-api.js';
import { parsePaperData } from './vendor/paper.js';
import {
  collectQuizLinks,
  createChallengeInstance,
  submitChallengeAnswers,
  submitChallengeScore,
} from './vendor/quiz.js';
import { buildSubmitSignature } from './vendor/submit-signature.js';

const MANIFEST = JSON.parse(
  readFileSync(new URL('./courseflow.module.json', import.meta.url), 'utf8'),
);

const SETTINGS = (() => {
  try {
    const parsed = JSON.parse(process.env.CF_MODULE_SETTINGS || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
})();
const SOURCE = SETTINGS.source === 'live' ? 'live' : 'fixture';
const TARGET_URL =
  typeof SETTINGS.target_url === 'string'
    ? SETTINGS.target_url
    : 'https://ucontent.unipus.cn/_ipublishpc_default/pc.html';
const COURSE_ID = typeof SETTINGS.course_id === 'string' ? SETTINGS.course_id : '';
const COURSE_NAME =
  typeof SETTINGS.course_name === 'string' && SETTINGS.course_name.trim()
    ? SETTINGS.course_name.trim()
    : 'U校园课程';
const BOOK_ID = typeof SETTINGS.book_id === 'string' ? SETTINGS.book_id : '';
const BOOK_VERSION = typeof SETTINGS.book_version === 'string' ? SETTINGS.book_version : '';
const IPUB_BASE =
  typeof SETTINGS.base_url === 'string' && SETTINGS.base_url.trim()
    ? SETTINGS.base_url.trim()
    : 'https://ipub.unipus.cn';
const CONTENT_BASE =
  typeof SETTINGS.content_base_url === 'string' && SETTINGS.content_base_url.trim()
    ? SETTINGS.content_base_url.trim()
    : 'https://ucontent.unipus.cn';

const SSO_BASE = 'https://sso.unipus.cn';
const UCONTENT_BASE = 'https://ucontent.unipus.cn';
const LOGIN_AES_KEY = Buffer.from('8AD70B641C024C7ADA2ECD082EC0334F', 'hex');
const LOGIN_AES_IV = Buffer.from('0102030405060708090A0B0C0D0E0F10', 'hex');
const ANNOTATOR_SECRET = 'a824b379f126b8b7aa5e33dee83fb0a05aa7462c';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'user-agent': BROWSER_UA,
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const log = (level, message) => process.stderr.write(`[unipus] ${level} ${message}\n`);

let nextId = 1;
const pending = new Map();

function hostCall(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  write({ jsonrpc: '2.0', id, method, params });
  return promise;
}

function hostLog(level, message) {
  write({ jsonrpc: '2.0', method: 'cw.log', params: { level, message } });
}

function errorText(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  return String(error);
}

function encryptLoginField(value) {
  const cipher = createCipheriv('aes-128-cbc', LOGIN_AES_KEY, LOGIN_AES_IV);
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase();
}

function signAnnotatorToken(openId, now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      open_id: openId,
      name: '',
      email: '',
      administrator: false,
      exp: now + 31536e6,
      iss: 'c4f772063dcfa98e9c50',
      aud: 'edx.unipus.cn',
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', ANNOTATOR_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function buildCasService(targetUrl) {
  const withoutHash = targetUrl.split('#')[0];
  return `${UCONTENT_BASE}:443/cas-auth/login/?next=${encodeURIComponent(withoutHash)}`;
}

function decodeJwtExpiry(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof claims.exp === 'number' ? claims.exp : undefined;
  } catch {
    return undefined;
  }
}

const challenges = new Map();
let challengeSeq = 0;

async function describe(params) {
  log('info', `describe framework=${params.framework_version ?? ''} source=${SOURCE}`);
  return {
    module: { name: 'courseflow-unipus', version: MANIFEST.version, module_api: 1 },
    platform: MANIFEST.platform,
  };
}

function placeholderQr() {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">' +
    '<rect width="160" height="160" fill="#fff"/>' +
    '<text x="80" y="78" font-size="13" text-anchor="middle" fill="#111">U校园骨架</text>' +
    '<text x="80" y="96" font-size="11" text-anchor="middle" fill="#666">请使用账号密码登录</text>' +
    '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function authBegin(params) {
  challengeSeq += 1;
  const id = String(params.session ?? `ch_unipus_${challengeSeq}_${Date.now()}`);
  const method = params.method === 'qr' ? 'qr' : 'password';
  challenges.set(id, { method, state: 'waiting', at: Date.now() });
  log('info', `auth.begin method=${method} challenge=${id}`);
  if (method === 'qr') {
    return {
      challenge: {
        id,
        kind: 'qr',
        image: placeholderQr(),
        expires_at: Math.floor(Date.now() / 1000) + 180,
      },
    };
  }
  return {
    challenge: {
      id,
      kind: 'password',
      expires_at: Math.floor(Date.now() / 1000) + 180,
      fields: [
        {
          name: 'username',
          label: 'U校园账号',
          type: 'text',
          required: true,
          autocomplete: 'username',
          placeholder: '手机号或邮箱',
        },
        {
          name: 'password',
          label: '密码',
          type: 'password',
          required: true,
          autocomplete: 'current-password',
        },
      ],
    },
  };
}

async function liveLogin(session, username, password) {
  const service = buildCasService(TARGET_URL);
  const loginPage = `${SSO_BASE}/sso/login?service=${encodeURIComponent(service)}`;

  await hostCall('cw.net.fetch', {
    session,
    method: 'GET',
    url: loginPage,
    stage: 'read',
    headers: {
      ...BROWSER_HEADERS,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  const loginResponse = await hostCall('cw.net.fetch', {
    session,
    method: 'POST',
    url: `${SSO_BASE}/sso/0.1/sso/cip/login`,
    encoding: 'json',
    stage: 'read',
    headers: {
      ...BROWSER_HEADERS,
      origin: SSO_BASE,
      referer: loginPage,
      accept: 'application/json, text/plain, */*',
    },
    body: {
      username: encryptLoginField(username),
      password: encryptLoginField(password),
      service,
      pcFlag: true,
      bindFlag: true,
      mfaCode: '',
    },
  });

  let login;
  try {
    login = JSON.parse(loginResponse.body);
  } catch {
    throw new Error(`SSO 返回非 JSON（HTTP ${loginResponse.status}）`);
  }
  if (login.code === '1506') throw new Error('平台要求验证码，请先在浏览器完成一次登录或稍后重试');
  if (login.code !== '0') {
    throw new Error(`SSO 登录失败：code ${login.code ?? '?'} ${login.msg ?? login.error ?? ''}`.trim());
  }
  const ticket = login.rs?.serviceTicket;
  const openId = login.rs?.openid;
  if (!ticket) throw new Error('SSO 未返回 serviceTicket');
  if (!openId) throw new Error('SSO 未返回 openid');

  const redeem = service.includes('?') ? `${service}&ticket=${ticket}` : `${service}?ticket=${ticket}`;
  try {
    await hostCall('cw.net.fetch', {
      session,
      method: 'GET',
      url: redeem,
      stage: 'read',
      headers: {
        ...BROWSER_HEADERS,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } catch (error) {
    // The redeem page can answer 403 while still setting the `jwt` cookie.
    // The browser token exchange is the authoritative next step, so keep going.
    if (error?.code !== 'platform_verification_required') throw error;
    log('warn', 'ticket redeem returned 403; continuing with captured cookies');
  }

  if (!COURSE_ID) {
    throw new Error('live 模式需要在模块设置里提供 course_id（reader token 交换用）');
  }

  const annotator = signAnnotatorToken(openId);
  let page;
  try {
    const opened = await hostCall('cw.browser.open', {
      session,
      url: TARGET_URL,
      purpose: 'reader-token',
    });
    page = opened?.page;
    if (!page) throw new Error('官方浏览器没有返回页面句柄');

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
      result = await hostCall('cw.browser.evaluate', {
        session,
        page,
        expression,
        stage: 'read',
      });
      if (result && result.loading !== true) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!result || result.loading === true) {
      throw new Error('官方页面尚未就绪，无法交换 reader token');
    }
    if (result.status !== 200 || !result.token) {
      throw new Error(`reader token 浏览器请求失败：HTTP ${result.status} @ ${result.href ?? ''} ${result.message ?? ''}`.trim());
    }

    return {
      token: result.token,
      openId,
      expiresAt: decodeJwtExpiry(result.token),
      displayName: username,
    };
  } finally {
    if (page) {
      await hostCall('cw.browser.close', { session, page }).catch(() => {});
    }
  }
}

async function authSubmit(params) {
  const id = String(params.challenge ?? '');
  const challenge = challenges.get(id);
  if (!challenge) return { state: 'expired' };
  const fields = params.fields && typeof params.fields === 'object' ? params.fields : {};
  const username = typeof fields.username === 'string' ? fields.username.trim() : '';
  const password = typeof fields.password === 'string' ? fields.password : '';
  if (!username || !password) {
    return { state: 'failed', message: '请输入账号和密码' };
  }

  log('info', `auth.submit mode=${SOURCE} challenge=${id}`);
  try {
    let identity;
    if (SOURCE === 'fixture') {
      identity = {
        token: 'fixture-reader-token',
        openId: 'unipus-fixture',
        displayName: 'U校园（离线）',
        expiresAt: undefined,
      };
    } else {
      identity = await liveLogin(id, username, password);
    }
    challenge.state = 'connected';
    challenge.identity = {
      display_name: identity.displayName,
      account_raw: identity.openId,
    };
    challenge.token = identity.token;
    await hostCall('cw.state', {
      session: id,
      namespace: 'auth',
      key: 'session',
      value: {
        token: identity.token,
        open_id: identity.openId,
        expires_at: identity.expiresAt ?? null,
        source: SOURCE,
        connected_at: Date.now(),
      },
    });
    log('info', `auth.submit connected source=${SOURCE}`);
    return { state: 'connected' };
  } catch (error) {
    const message = errorText(error);
    challenge.state = 'failed';
    challenge.message = message;
    log('warn', `auth.submit failed: ${message}`);
    return { state: 'failed', message };
  }
}

function authPoll(params) {
  const challenge = challenges.get(String(params.challenge ?? ''));
  if (!challenge) return { state: 'expired' };
  return { state: challenge.state };
}

function authComplete(params) {
  const id = String(params.challenge ?? '');
  const challenge = challenges.get(id);
  if (!challenge) throw { code: 'invalid_params', message: '登录挑战不存在' };
  const identity = challenge.identity;
  challenges.delete(id);
  if (!identity) throw { code: 'invalid_params', message: '登录尚未完成' };
  return identity;
}

async function authVerify(params) {
  try {
    const identity = await hostCall('cw.session.identity', { session: params.session });
    return {
      display_name: identity?.display_name ?? 'U校园',
      account_raw: identity?.account_raw ?? '',
      connected_at: identity?.connected_at ?? null,
    };
  } catch {
    return { display_name: 'U校园', account_raw: '' };
  }
}

async function authKeepalive(params) {
  if (SOURCE === 'fixture') return { ok: true, mode: SOURCE };
  try {
    const state = await hostCall('cw.state', {
      session: params.session,
      namespace: 'auth',
      key: 'session',
    });
    if (!state?.value?.token) return { ok: false, reason: 'no-token' };
    return { ok: true, mode: SOURCE, expires_at: state.value.expires_at ?? null };
  } catch (error) {
    return { ok: false, reason: error.message ?? 'state-unavailable' };
  }
}

const smokeCache = new Map();

async function smokeFetch(session) {
  const result = { allowed: null, blocked: null, state: null, identity: null };
  try {
    const response = await hostCall('cw.net.fetch', {
      session,
      method: 'GET',
      url:
        'https://sso.unipus.cn/sso/login?service=' +
        encodeURIComponent(
          'https://ucontent.unipus.cn/cas-auth/login/?next=' +
            encodeURIComponent('https://ucontent.unipus.cn/pc.html'),
        ),
      stage: 'read',
    });
    result.allowed = {
      status: response.status,
      bytes: typeof response.body === 'string' ? response.body.length : 0,
    };
    log('info', `cw.net.fetch allowed status=${response.status}`);
  } catch (error) {
    result.allowed = { error: error.code ?? 'unknown', message: error.message ?? String(error) };
    log('warn', `cw.net.fetch allowed failed: ${result.allowed.error}`);
  }

  try {
    await hostCall('cw.net.fetch', {
      session,
      method: 'GET',
      url: 'https://example.com/',
      stage: 'read',
    });
    result.blocked = { unexpected: 'request succeeded' };
    log('warn', 'cw.net.fetch blocked host unexpectedly succeeded');
  } catch (error) {
    result.blocked = { code: error.code ?? 'unknown', message: error.message ?? String(error) };
    log('info', `cw.net.fetch blocked as expected: ${result.blocked.code}`);
  }

  try {
    await hostCall('cw.state', {
      session,
      namespace: 'smoke',
      key: 'lastFetch',
      value: { at: Date.now(), allowed: result.allowed, blocked: result.blocked },
    });
    const stored = await hostCall('cw.state', {
      session,
      namespace: 'smoke',
      key: 'lastFetch',
    });
    result.state = stored?.value ? 'round-trip-ok' : 'empty';
    log('info', `cw.state ${result.state}`);
  } catch (error) {
    result.state = `error:${error.code ?? error.message}`;
    log('warn', `cw.state failed: ${result.state}`);
  }

  try {
    const identity = await hostCall('cw.session.identity', { session });
    result.identity = identity;
    log('info', `cw.session.identity account_raw=${identity?.account_raw ?? ''}`);
  } catch (error) {
    result.identity = { error: error.code ?? error.message };
    log('warn', `cw.session.identity failed: ${result.identity.error}`);
  }

  hostLog('info', `unipus skeleton smoke: ${JSON.stringify(result)}`);
  return result;
}

class HostResponse {
  status: number;
  ok: boolean;
  body: string;
  headers: { get(name: string): string | null };

  constructor(response: any) {
    this.status = Number(response?.status ?? 0);
    this.ok = this.status >= 200 && this.status < 300;
    this.body = typeof response?.body === 'string' ? response.body : '';
    const raw = response?.headers ?? {};
    const lower = new Map<string, string>();
    for (const [key, value] of Object.entries(raw)) lower.set(String(key).toLowerCase(), String(value));
    this.headers = { get: (name: string) => lower.get(String(name).toLowerCase()) ?? null };
  }

  async text(): Promise<string> {
    return this.body;
  }

  async json(): Promise<any> {
    return JSON.parse(this.body);
  }
}

/** Route every vendored unicheat `fetch` through the host. */
function hostFetchFor(session: string) {
  return async (input: any, init: any = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    delete headers.cookie;
    delete headers.host;
    delete headers['content-length'];
    const rawBody = init.body;
    const body =
      rawBody === undefined || rawBody === null
        ? undefined
        : typeof rawBody === 'string'
          ? rawBody
          : String(rawBody);
    const stage = /\/api\/reader\/action\/finishNode|\/api\/reader\/answer\/submitScore|\/api\/reader\/answer\/judgeStart|\/api\/reader\/answer\/judgeResult/.test(url)
      ? 'save_study'
      : 'read';
    const response = await hostCall('cw.net.fetch', {
      session,
      method: String(init.method ?? 'GET').toUpperCase(),
      url,
      headers,
      ...(body !== undefined ? { body, encoding: 'raw' } : {}),
      stage,
    });
    return new HostResponse(response);
  };
}

function authHeader(token: string): string {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function baseHeaders(token: string): Record<string, string> {
  return {
    authorization: authHeader(token),
    lovefrom: 'learner',
    accept: 'application/json, text/plain, */*',
  };
}

async function readAuth(session: string): Promise<any> {
  const stored = await hostCall('cw.state', { session, namespace: 'auth', key: 'session' });
  const value = (stored as any)?.value;
  if (!value?.token) throw { code: 'platform_login_expired', message: '请先连接 U校园' };
  return value;
}

function courseConfig() {
  if (!COURSE_ID || !BOOK_ID || !BOOK_VERSION) return null;
  return { id: COURSE_ID, name: COURSE_NAME, bookId: BOOK_ID, bookVersion: BOOK_VERSION };
}

function treeUnitNumber(treeUnit: any, index: number): number {
  const digits = String(treeUnit?.id ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : index + 1;
}

function chapterForUnit(treeUnit: any, chapters: any[], index: number) {
  const number = treeUnitNumber(treeUnit, index);
  return chapters.find((chapter) => Number(chapter?.chapterNumber) === number) ?? chapters[index] ?? null;
}

function walkGroups(unit: any, group: any, visit: (unit: any, group: any) => void) {
  visit(unit, group);
  for (const child of group?.children ?? []) walkGroups(unit, child, visit);
}

function findGroup(units: any[], groupId: string): { unit: any; group: any } | null {
  let found: { unit: any; group: any } | null = null;
  for (const unit of units) {
    for (const child of unit?.children ?? []) {
      walkGroups(unit, child, (owner, group) => {
        if (!found && String(group?.id ?? '') === groupId) found = { unit: owner, group };
      });
    }
  }
  return found;
}

async function fetchChapterList(fetcher: any, token: string, cfg: any): Promise<any[]> {
  const url =
    `${IPUB_BASE}/api/reader/chapter/getChapterList?bookId=${encodeURIComponent(cfg.bookId)}` +
    `&bookVersionNumber=${encodeURIComponent(cfg.bookVersion)}`;
  const response = await fetcher(url, { headers: baseHeaders(token) });
  const json = await response.json();
  return Array.isArray(json?.data?.chapterList) ? json.data.chapterList : [];
}

async function fetchChapterVersion(
  fetcher: any,
  token: string,
  cfg: any,
  chapterId: string,
): Promise<string> {
  const url =
    `${IPUB_BASE}/api/reader/chapter/getChapterInfo?bookId=${encodeURIComponent(cfg.bookId)}` +
    `&bookVersionNumber=${encodeURIComponent(cfg.bookVersion)}` +
    `&chapterId=${encodeURIComponent(chapterId)}`;
  const response = await fetcher(url, { headers: baseHeaders(token) });
  const json = await response.json();
  const data = json?.data ?? {};
  let version = data.versionNumber ? String(data.versionNumber) : undefined;
  if (!version && typeof data.content === 'string') {
    const match = data.content.match(/\/([^/]+)\/studentContent\.json/);
    if (match) version = match[1];
  }
  if (!version) throw new Error(`无法解析 chapterVersionNumber（chapter ${chapterId}）`);
  return version;
}

function isVideoGroup(base: string): boolean {
  return base === 'insert-video';
}

function isTextGroup(base: string): boolean {
  return (TEXT_LEAF_BASES as readonly string[]).includes(base);
}

const structureCache = new Map<string, { at: number; value: any }>();

async function getChapterStructure(
  fetcher: any,
  token: string,
  cfg: any,
  chapterId: string,
): Promise<any> {
  const key = `${cfg.bookId}:${chapterId}`;
  const cached = structureCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;
  const value = await fetchChapterStructure(
    { token, baseUrl: IPUB_BASE },
    { bookId: cfg.bookId, bookVersionNumber: cfg.bookVersion, chapterId },
    fetcher,
  );
  structureCache.set(key, { at: Date.now(), value });
  return value;
}

async function readCachedAnswers(session: string, key: string): Promise<any[] | null> {
  try {
    const stored = await hostCall('cw.state', { session, namespace: 'answers', key });
    const value = (stored as any)?.value;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function solveQuestions(session: string, activity: any): Promise<any[]> {
  const payload = (activity.questions ?? []).map((question: any) => ({
    id: question.id,
    type: question.type,
    stem: question.stem,
    options: (question.options ?? []).map((option: any) => option.text),
    blanks: question.blankCount ?? 0,
    ...(question.passage ? { passage: question.passage } : {}),
  }));
  const prompt = [
    '你是 U校园 英语课程答题助手。',
    '只输出 JSON 数组，不要解释。每项格式 {"id":"题目id","texts":["答案"]}。',
    '选择题 texts 必须是选项原文，不要用 A/B/C/D。',
    '填空题按空位顺序给出多个 texts。',
    JSON.stringify(payload),
  ].join('\n');
  const response = await hostCall('cw.ai.generate', { session, prompt });
  const raw = String((response as any)?.text ?? '').trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned);
  const byId = new Map<string, string[]>();
  for (const item of Array.isArray(parsed) ? parsed : []) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '');
    const texts = Array.isArray(item.texts) ? item.texts.map(String) : [];
    if (id) byId.set(id, texts);
  }
  return (activity.questions ?? []).map((question: any) => ({
    questionId: question.id,
    texts: byId.get(question.id) ?? [],
    confidence: 0.8,
    source: 'llm',
  }));
}

async function studyQuestionStep(
  params: any,
  session: string,
  cfg: any,
  auth: any,
  fetcher: any,
  rawId: string,
): Promise<any> {
  const parts = rawId.split('::');
  const chapterId = parts[1] ?? '';
  const key = decodeURIComponent(parts[2] ?? '');
  const index = Number(parts[3] ?? 0);

  const structure = await getChapterStructure(fetcher, auth.token, cfg, chapterId);
  const activities = structure?.structure?.activities ?? [];
  const activity =
    activities.find((item: any) => String(item.anchor ?? item.title) === key) ??
    activities[index];
  if (!activity || !Array.isArray(activity.questions) || activity.questions.length === 0) {
    throw { code: 'not_found', message: '章节结构里找不到该题目组' };
  }

  const chapterVersion =
    structure.chapterVersionNumber ??
    (await fetchChapterVersion(fetcher, auth.token, cfg, chapterId));
  const meta = {
    bookId: cfg.bookId,
    bookVersionNumber: cfg.bookVersion,
    chapterId,
    chapterVersionNumber: chapterVersion,
    referer: buildChapterReferer({
      bookId: cfg.bookId,
      bookVersionNumber: cfg.bookVersion,
      chapterId,
    }),
  };

  if (params.checkpoint?.phase !== 'submitted') {
    let answers = await readCachedAnswers(session, rawId);
    if (!answers) {
      answers = await solveQuestions(session, activity);
      await hostCall('cw.state', {
        session,
        namespace: 'answers',
        key: rawId,
        value: answers,
      });
    }
    const { submissions, warnings } = buildChapterSubmissions(activity.questions, answers);
    if (warnings.length > 0) log('warn', `chapter warnings: ${warnings.join('; ')}`);
    for (const submission of submissions) {
      if (submission.mode === 'judge') {
        const outcome = await submitChapterJudge(
          { token: auth.token, baseUrl: IPUB_BASE },
          meta,
          submission,
          { fetcher, maxAttempts: 2, pollIntervalMs: 1000 },
        );
        log(
          'info',
          `judge ${submission.groupId} polls=${outcome.polls} score=${outcome.score ?? 'pending'}` +
            (outcome.warnings.length > 0 ? ` warnings=${outcome.warnings.join('; ')}` : ''),
        );
        if (!outcome.responses.score?.ok) {
          log('warn', `judge submitScore not ok for ${submission.groupId}`);
        }
        continue;
      }
      const result = await submitChapterScore(
        { token: auth.token, baseUrl: IPUB_BASE },
        meta,
        submission,
        fetcher,
      );
      log(
        'info',
        `submitScore ${submission.groupId} HTTP ${result.status} code ${(result.json as any)?.code ?? '?'}`,
      );
      if (!result.ok) throw new Error(`submitScore failed: HTTP ${result.status}`);
    }
  }

  const checks: boolean[] = [];
  for (const group of activity.questionGroups ?? []) {
    const version =
      group.versionNumber ??
      activity.questions.find((question: any) => question.groupId === group.groupId)?.groupVersion ??
      '';
    const result = await fetchChapterAnswerList(
      { token: auth.token, baseUrl: IPUB_BASE },
      group.groupId,
      version,
      fetcher,
    );
    const answered = Boolean(
      result.data &&
        (result.data.score !== undefined ||
          (result.data.userAnswersResult?.length ?? 0) > 0),
    );
    checks.push(answered);
  }
  if (checks.length > 0 && checks.every(Boolean)) {
    return {
      status: 'completed',
      evidence: { platform_confirmed: true, groups: checks.length },
      checkpoint: { phase: 'done' },
    };
  }
  return { status: 'in_progress', wait_ms: 2000, checkpoint: { phase: 'submitted' } };
}

const paperCache = new Map<string, any>();

function paperReferer(meta: any): string {
  return buildChapterReferer({
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersion,
    chapterId: meta.chapterId,
  });
}

async function refreshPapers(session: string, cfg: any, auth: any, fetcher: any): Promise<void> {
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: '', courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher,
  );
  const treeLinks = collectQuizLinks(tree);
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);
  const collected: Array<{ paperId: string; paperType: number; chapterId: string; chapterName: string }> = [];

  for (const link of treeLinks) {
    collected.push({ paperId: link.paperId, paperType: 0, chapterId: '', chapterName: link.unitName });
  }

  for (const chapter of chapters) {
    let structure: any;
    try {
      structure = await getChapterStructure(fetcher, auth.token, cfg, String(chapter.id));
    } catch (error) {
      log('warn', `paper structure ${chapter.id} failed: ${errorText(error)}`);
      continue;
    }
    const links: any[] = [];
    for (const raw of structure?.raw?.quizPaperLinks ?? []) {
      try {
        const link = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (link?.paperId) links.push(link);
      } catch {
        // ignore malformed links
      }
    }
    for (const activity of structure?.structure?.activities ?? []) {
      for (const link of activity.paperLinks ?? []) if (link?.paperId) links.push(link);
    }
    for (const link of links) {
      collected.push({
        paperId: String(link.paperId),
        paperType: Number(link.paperType ?? 0),
        chapterId: String(chapter.id),
        chapterName: String(chapter.name ?? ''),
      });
    }
  }

  const byId = new Map<string, { paperId: string; paperType: number; chapterId: string; chapterName: string }>();
  for (const entry of collected) {
    const existing = byId.get(entry.paperId);
    if (!existing) {
      byId.set(entry.paperId, { ...entry });
      continue;
    }
    if (!existing.chapterId && entry.chapterId) {
      existing.chapterId = entry.chapterId;
      existing.chapterName = entry.chapterName;
    }
    if (!existing.paperType && entry.paperType) existing.paperType = entry.paperType;
  }

  for (const entry of byId.values()) {
    const paperId = entry.paperId;
    let paperType = entry.paperType;
    let paperName = paperId;
    let versionNumber = '';
    try {
      const response = await fetcher(
        `${IPUB_BASE}/api/reader/paper/getPaperVersionByPublishedBook`,
        {
          method: 'POST',
          headers: { ...baseHeaders(auth.token), 'content-type': 'application/json' },
          body: JSON.stringify({
            bookId: cfg.bookId,
            bookVersionNumber: cfg.bookVersion,
            paperId,
          }),
        },
      );
      const json = await response.json();
      if (json?.data) {
        paperName = String(json.data.paperName ?? paperName);
        versionNumber = String(json.data.versionNumber ?? '');
        if (!paperType && json.data.paperType) paperType = Number(json.data.paperType);
      }
    } catch (error) {
      log('warn', `paper version ${paperId} failed: ${errorText(error)}`);
    }
    if (paperType !== 2 && paperType !== 3) paperType = 2;
    paperCache.set(paperId, {
      paperId,
      paperType,
      paperName,
      versionNumber,
      chapterId: entry.chapterId,
      chapterName: entry.chapterName,
      bookId: cfg.bookId,
      bookVersion: cfg.bookVersion,
    });
  }
}

async function catalogPapers(params: any) {
  if (SOURCE !== 'live') return { papers: [] };
  const session = String(params.session ?? '');
  const cfg = courseConfig();
  if (!cfg) throw { code: 'invalid_params', message: '请在模块设置里配置 course_id / book_id / book_version' };
  if (params.course?.id && params.course.id !== cfg.id) return { papers: [] };
  const auth = await readAuth(session);
  const fetcher: any = hostFetchFor(session);
  await refreshPapers(session, cfg, auth, fetcher);
  return {
    papers: [...paperCache.values()].map((meta) => ({
      id: meta.paperId,
      name: meta.paperName,
      category: meta.paperType === 3 ? 'unit_test' : 'challenge',
      available: true,
      done: false,
      can_redo: true,
      can_review: true,
      score: null,
      attempts_left: null,
      ends_at: null,
    })),
  };
}

function examQuestionKind(question: any): string {
  if (question.type === 'single') return 'single';
  if (question.type === 'multiple') return 'multiple';
  if (question.type === 'judge') return 'judge';
  if (question.type === 'matching') return (question.options?.length ?? 0) > 0 ? 'multiple' : 'blank';
  if (question.type === 'fill') return 'blank';
  // short / reading / writing / translation / discussion / speaking / upload / unknown
  return 'blank';
}

function examQuestionBlanks(question: any): number {
  if (question.type === 'single' || question.type === 'multiple' || question.type === 'judge') {
    return 0;
  }
  return Math.max(1, Number(question.blankCount ?? 1));
}

function examQuestionText(question: any): string {
  const body = [question.passage, question.stem].filter(Boolean).join('\n\n');
  if (question.rawType === 'translation') {
    return `请完成下面的翻译题目，只输出译文：\n${body}`;
  }
  return body;
}

function toExamAttempt(paperData: any) {
  return {
    id: paperData.instanceId,
    paper_id: paperData.paperId,
    name: paperData.paperName,
    expires_at: null,
    questions: (paperData.questions ?? []).map((question: any) => ({
      id: question.id,
      kind: examQuestionKind(question),
      text: examQuestionText(question),
      options: (question.options ?? []).map((option: any) => ({
        id: String(option.optionId ?? option.value ?? option.index),
        text: option.text,
      })),
      answer: [],
      blanks: examQuestionBlanks(question),
    })),
  };
}

async function createUnitTestInstance(fetcher: any, auth: any, cfg: any, meta: any) {
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/instance/createPaperInstanceByPublishedBook`,
    {
      method: 'POST',
      headers: { ...baseHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        bookId: cfg.bookId,
        bookVersionNumber: cfg.bookVersion,
        paperId: meta.paperId,
        versionNumber: meta.versionNumber,
        testMode: 1,
      }),
    },
  );
  const json = await response.json();
  if (json.code !== 200 || !json.data) {
    throw new Error(`createPaperInstance failed: ${json.message ?? `code ${json.code}`}`);
  }
  return parsePaperData(json.data);
}

async function saveUnitTestAnswers(fetcher: any, auth: any, paperData: any, answers: any[]) {
  const payload = buildPaperSavePayload(paperData, answers, 1);
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/answer/saveUserPaperAnswer`,
    {
      method: 'POST',
      headers: { ...baseHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const json = await response.json();
  if (json.code !== 200) throw new Error(`saveUserPaperAnswer failed: ${json.message ?? `code ${json.code}`}`);
  log('info', `exam unit_test draft saved code=${json.code}`);
}

async function submitUnitTest(fetcher: any, auth: any, paperData: any, answers: any[], meta: any) {
  const timestamp = Date.now();
  const payload = buildPaperSubmitPayload(paperData, answers, 1, timestamp);
  const referer = paperReferer(meta);
  const signature = buildSubmitSignature({
    authorization: authHeader(auth.token),
    openId: auth.open_id,
    referer,
    timestamp,
  });
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/answer/submitUserPaperAnswer`,
    {
      method: 'POST',
      headers: {
        authorization: authHeader(auth.token),
        lovefrom: 'learner',
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        origin: 'https://ipub.unipus.cn',
        referer,
        'x-referer': referer,
        v: signature,
      },
      body: JSON.stringify(payload),
    },
  );
  const json = await response.json();
  if (json.code !== 200) throw new Error(`submitUserPaperAnswer failed: ${json.message ?? `code ${json.code}`}`);
  log('info', `exam unit_test submit code=${json.code}`);
}

async function readPaperScore(fetcher: any, auth: any, paperData: any) {
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/answer/getUserPaperScore`,
    {
      method: 'POST',
      headers: { ...baseHeaders(auth.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: paperData.instanceId,
        paperId: paperData.paperId,
        versionNumber: paperData.versionNumber,
        paperType: paperData.paperType,
        testMode: 1,
      }),
    },
  );
  const json = await response.json();
  return json?.data ?? {};
}

async function examOpen(params: any) {
  const session = String(params.session ?? '');
  const cfg = courseConfig();
  if (!cfg) throw { code: 'invalid_params', message: '请在模块设置里配置 course_id / book_id / book_version' };
  const auth = await readAuth(session);
  const fetcher: any = hostFetchFor(session);
  const paperId = String(params.paper_id ?? '');
  let meta = paperCache.get(paperId);
  if (!meta) {
    await refreshPapers(session, cfg, auth, fetcher);
    meta = paperCache.get(paperId);
  }
  if (!meta) throw { code: 'not_found', message: '试卷不存在' };

  let paperData: any;
  if (meta.paperType === 2) {
    const instance = await createChallengeInstance(
      { token: auth.token, baseUrl: IPUB_BASE },
      { bookId: cfg.bookId, bookVersionNumber: cfg.bookVersion, paperId: meta.paperId },
      fetcher,
    );
    paperData = parsePaperData(instance);
  } else {
    paperData = await createUnitTestInstance(fetcher, auth, cfg, meta);
  }
  if (!paperData.instanceId) throw new Error('试卷实例缺少 instanceId');
  log(
    'info',
    `exam open ${paperData.paperId} ` +
      (paperData.questions ?? [])
        .map((question: any) => `${question.rawType}:${question.type}:${question.blankCount}:${question.options?.length ?? 0}`)
        .join(','),
  );

  await hostCall('cw.state', {
    session,
    namespace: 'exam',
    key: `paper/${paperData.instanceId}`,
    value: { meta, paperData, answers: {}, phase: 'opened' },
  });
  await hostCall('cw.state', {
    session,
    namespace: 'exam',
    key: `latest/${paperData.paperId}`,
    value: paperData.instanceId,
  });
  return { ready: true, attempt: toExamAttempt(paperData) };
}

async function examWrite(params: any) {
  const session = String(params.session ?? '');
  const auth = await readAuth(session);
  const fetcher: any = hostFetchFor(session);
  const attemptId = String(params.attempt_id ?? '');
  const stored = await hostCall('cw.state', {
    session,
    namespace: 'exam',
    key: `paper/${attemptId}`,
  });
  const state = (stored as any)?.value;
  if (!state?.paperData || !state?.meta) throw { code: 'not_found', message: '试卷实例不存在' };

  const incoming = params.answers && typeof params.answers === 'object' ? params.answers : {};
  const merged = { ...(state.answers ?? {}), ...incoming };
  const byQuestion = new Map(
    (state.paperData.questions ?? []).map((question: any) => [question.id, question]),
  );
  const answerList = Object.entries(merged).map(([questionId, texts]) => {
    const question: any = byQuestion.get(questionId);
    const values = Array.isArray(texts) ? texts.map(String) : [];
    const converted = values.map((value) => {
      const options = question?.options ?? [];
      const match = options.find(
        (option: any) =>
          String(option.optionId ?? '') === value ||
          String(option.value ?? '') === value ||
          String(option.label ?? '') === value,
      );
      return match?.text ?? value;
    });
    return {
      questionId,
      texts: converted,
      confidence: 1,
      source: 'manual',
    };
  });
  const phase = params.phase === 'submit' ? 'submit' : 'draft';

  if (state.meta.paperType === 2) {
    if (phase !== 'submit') {
      await hostCall('cw.state', {
        session,
        namespace: 'exam',
        key: `paper/${attemptId}`,
        value: { ...state, answers: merged, phase: 'draft' },
      });
      return { done: true, cursor: null, draft_supported: false };
    }
    if (state.phase === 'submitted') {
      return { done: true, cursor: null, draft_supported: false };
    }
    const timestamp = Date.now();
    const answerMap = buildPaperAnswerMap(state.paperData, answerList);
    log(
      'info',
      `exam challenge paper=${state.paperData.paperId} answers=${answerList.length} groups=${Object.keys(answerMap).length}`,
    );
    const payload = {
      instanceId: state.paperData.instanceId,
      paperType: state.paperData.paperType,
      userAnswerParamsMap: answerMap,
      a: timestamp,
      b: timestamp,
    };
    const answer = await submitChallengeAnswers(
      { token: auth.token, baseUrl: IPUB_BASE, referer: paperReferer(state.meta) },
      payload,
      fetcher,
    );
    log(
      'info',
      `exam challenge answer code=${answer.code ?? '?'} message=${String(answer.message ?? '').slice(0, 120)}`,
    );
    if (answer.code !== 0 && answer.code !== 200) {
      throw new Error(`submitUserPaperAnswer failed: ${answer.message ?? `code ${answer.code}`}`);
    }
    const score = await submitChallengeScore(
      { token: auth.token, baseUrl: IPUB_BASE, referer: paperReferer(state.meta) },
      { paperId: state.paperData.paperId, versionNumber: state.paperData.versionNumber },
      fetcher,
    );
    log(
      'info',
      `exam challenge score code=${score.code ?? '?'} status=${score.data?.status ?? '?'} userScore=${score.data?.userScore ?? '?'}`,
    );
    if (score.code !== 0 && score.code !== 200) {
      throw new Error(`submitUserChallengeScore failed: ${score.message ?? `code ${score.code}`}`);
    }
    await hostCall('cw.state', {
      session,
      namespace: 'exam',
      key: `paper/${attemptId}`,
      value: { ...state, answers: merged, phase: 'submitted' },
    });
    return { done: true, cursor: null, draft_supported: false };
  }

  if (phase === 'submit') {
    await submitUnitTest(fetcher, auth, state.paperData, answerList, state.meta);
    await hostCall('cw.state', {
      session,
      namespace: 'exam',
      key: `paper/${attemptId}`,
      value: { ...state, answers: merged, phase: 'submitted' },
    });
    return { done: true, cursor: null, draft_supported: true };
  }

  await saveUnitTestAnswers(fetcher, auth, state.paperData, answerList);
  await hostCall('cw.state', {
    session,
    namespace: 'exam',
    key: `paper/${attemptId}`,
    value: { ...state, answers: merged, phase: 'draft' },
  });
  return { done: true, cursor: null, draft_supported: true };
}

async function examReadback(params: any) {
  const session = String(params.session ?? '');
  const auth = await readAuth(session);
  const fetcher: any = hostFetchFor(session);
  const attemptId = String(params.attempt_id ?? '');
  const stored = await hostCall('cw.state', {
    session,
    namespace: 'exam',
    key: `paper/${attemptId}`,
  });
  const state = (stored as any)?.value;
  if (!state?.paperData) throw { code: 'not_found', message: '试卷实例不存在' };
  const score = await readPaperScore(fetcher, auth, state.paperData);
  log(
    'info',
    `exam readback status=${score.status ?? '?'} score=${score.paperScore?.userScore ?? score.totalScore ?? '?'}`,
  );
  return {
    confirmed: score.status === 1,
    attempt_id: attemptId,
    score: score.paperScore?.userScore ?? score.totalScore ?? null,
    graded_answers: [],
    review: null,
  };
}

async function examReview(params: any) {
  const session = String(params.session ?? '');
  let attemptId = String(params.attempt_id ?? '');
  if (!attemptId && params.paper_id) {
    const latest = await hostCall('cw.state', {
      session,
      namespace: 'exam',
      key: `latest/${String(params.paper_id)}`,
    });
    attemptId = String((latest as any)?.value ?? '');
  }
  if (!attemptId) return { ready: false };
  const stored = await hostCall('cw.state', {
    session,
    namespace: 'exam',
    key: `paper/${attemptId}`,
  });
  const state = (stored as any)?.value;
  if (!state?.paperData) return { ready: false };
  return { ready: true, attempt: toExamAttempt(state.paperData) };
}

async function catalogCourses(params) {
  const session = String(params.session ?? '');
  if (SOURCE === 'live') {
    const cfg = courseConfig();
    if (!cfg) {
      throw {
        code: 'invalid_params',
        message: '请在模块设置里配置 course_id / book_id / book_version',
      };
    }
    await readAuth(session);
    return {
      courses: [
        {
          id: cfg.id,
          recruit_id: cfg.id,
          name: cfg.name,
          kind: 'shared',
          kind_label: '共享课',
          family: 'shared',
          progress: null,
          outline_available: true,
        },
      ],
    };
  }
  return {
    courses: [
      {
        id: 'unipus-demo',
        recruit_id: 'unipus-demo-class',
        name: 'U校园（骨架课程）',
        kind: 'shared',
        kind_label: '共享课',
        family: 'shared',
        progress: 0,
        outline_available: true,
      },
    ],
  };
}

async function catalogUnits(params) {
  if (SOURCE !== 'live') {
    if (params.course?.id !== 'unipus-demo') return { units: [] };
    return {
      units: [
        {
          id: 'unipus-demo-u1',
          name: '第 1 章 · 骨架单元',
          chapter_id: 'unipus-demo-c1',
          chapter_name: '第 1 章',
          lesson_id: 'unipus-demo-l1',
          kind: 'video',
          duration_seconds: 60,
          watched_seconds: 0,
          state: 'not_started',
          video_id: 'unipus-demo-v1',
          selectable: true,
        },
        {
          id: 'unipus-demo-u2',
          name: '第 1 章 · 阅读骨架',
          chapter_id: 'unipus-demo-c1',
          chapter_name: '第 1 章',
          lesson_id: 'unipus-demo-l2',
          kind: 'reading',
          duration_seconds: 0,
          watched_seconds: 0,
          state: 'not_started',
          video_id: null,
          selectable: true,
        },
      ],
    };
  }

  const session = String(params.session ?? '');
  const cfg = courseConfig();
  if (!cfg) {
    throw {
      code: 'invalid_params',
      message: '请在模块设置里配置 course_id / book_id / book_version',
    };
  }
  if (params.course?.id !== cfg.id) throw { code: 'not_found', message: '课程不存在' };

  const auth = await readAuth(session);
  const fetcher: any = hostFetchFor(session);
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: '', courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher,
  );
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);

  let durations = new Map<string, any>();
  try {
    durations = await fetchVideoDurations(
      {
        token: auth.token,
        baseUrl: IPUB_BASE,
        bookId: cfg.bookId,
        bookVersionNumber: cfg.bookVersion,
      },
      fetcher,
    );
  } catch (error) {
    log('warn', `video durations failed: ${errorText(error)}`);
  }

  const units: any[] = [];
  for (let index = 0; index < tree.length; index += 1) {
    const treeUnit = tree[index];
    const chapter = chapterForUnit(treeUnit, chapters, index);
    const chapterId = chapter?.id ? String(chapter.id) : '';
    const chapterName = String(treeUnit?.name ?? chapter?.name ?? '');

    let progress: Record<string, any> = {};
    try {
      progress = await fetchUnitProgress(
        {
          token: auth.token,
          cookie: '',
          courseId: cfg.id,
          unit: String(treeUnit.id),
          openId: auth.open_id,
          baseUrl: CONTENT_BASE,
        },
        fetcher,
      );
    } catch (error) {
      log('warn', `progress ${treeUnit.id} failed: ${errorText(error)}`);
    }

    for (const child of treeUnit?.children ?? []) {
      walkGroups(treeUnit, child, (owner: any, group: any) => {
        const base = String(group?.base ?? '');
        const anchor = String(group?.externalNodeId ?? '');
        if (!anchor) return;
        if (!isVideoGroup(base) && !isTextGroup(base)) return;
        const kind = isVideoGroup(base) ? 'video' : 'reading';
        const durationMs = isVideoGroup(base)
          ? Number(durations.get(anchor)?.durationMs ?? 0)
          : 0;
        const pass = Number(progress?.[group.id]?.pass ?? 0);
        units.push({
          id: `${group.id}::${base}`,
          name: String(group.name ?? (kind === 'video' ? '视频' : '阅读')).trim(),
          chapter_id: chapterId,
          chapter_name: chapterName,
          lesson_id: String(owner?.id ?? ''),
          kind,
          duration_seconds: durationMs > 0 ? Math.round(durationMs / 1000) : 0,
          watched_seconds: 0,
          state: pass === 1 ? 'completed' : 'not_started',
          video_id: kind === 'video' ? anchor : null,
          selectable: true,
        });
      });
    }

    if (SETTINGS.include_questions !== false && chapterId) {
      try {
        const structure = await getChapterStructure(fetcher, auth.token, cfg, chapterId);
        const activities = structure?.structure?.activities ?? [];
        activities.forEach((activity: any, activityIndex: number) => {
          if (!activity.questions?.length) return;
          const key = activity.anchor ?? activity.title ?? `activity-${activityIndex}`;
          units.push({
            id: `q::${chapterId}::${encodeURIComponent(key)}::${activityIndex}`,
            name: String(activity.title ?? `题目 ${activityIndex + 1}`).trim(),
            chapter_id: chapterId,
            chapter_name: chapterName,
            lesson_id: activity.anchor ?? '',
            kind: 'document',
            duration_seconds: 0,
            watched_seconds: 0,
            state: 'not_started',
            video_id: null,
            selectable: true,
            selectable_note: (activity.questionGroups ?? [])
              .map((group: any) => group.groupType)
              .filter(Boolean)
              .join(','),
          });
        });
      } catch (error) {
        log('warn', `chapter structure ${chapterId} failed: ${errorText(error)}`);
      }
    }
  }

  log('info', `catalog.units course=${cfg.id} units=${units.length}`);
  return { units };
}

async function studyStep(params) {
  if (SOURCE !== 'live') {
    const unit = params.unit ?? {};
    const duration = Number(unit.duration_seconds ?? 60);
    const current = Number(params.checkpoint?.seconds ?? 0);
    const next = Math.min(duration, current + 30);
    if (duration === 0 || next >= duration) {
      return {
        status: 'completed',
        evidence: { watched_seconds: next, stub: true },
        checkpoint: { seconds: next },
      };
    }
    return {
      status: 'in_progress',
      progress: { watched_seconds: next },
      wait_ms: 300,
      checkpoint: { seconds: next },
    };
  }

  const session = String(params.session ?? '');
  const cfg = courseConfig();
  if (!cfg) {
    throw {
      code: 'invalid_params',
      message: '请在模块设置里配置 course_id / book_id / book_version',
    };
  }
  const unit = params.unit ?? {};
  const rawId = String(unit.id ?? '');
  if (rawId.startsWith('q::')) {
    const auth = await readAuth(session);
    const fetcher: any = hostFetchFor(session);
    return studyQuestionStep(params, session, cfg, auth, fetcher, rawId);
  }
  const groupId = rawId.split('::')[0];
  if (!groupId) throw { code: 'invalid_params', message: '缺少单元 id' };

  const auth = await readAuth(session);
  const fetcher: any = hostFetchFor(session);
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: '', courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher,
  );
  const found = findGroup(tree, groupId);
  if (!found) throw { code: 'not_found', message: '课程树里找不到该单元' };

  const base = String(found.group.base ?? unit.lesson_id ?? '');
  const anchor = String(found.group.externalNodeId ?? unit.video_id ?? '');
  if (!anchor) throw { code: 'invalid_params', message: '单元缺少 anchor' };

  const index = Math.max(0, tree.indexOf(found.unit));
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);
  const chapter = chapterForUnit(found.unit, chapters, index);
  if (!chapter?.id) throw { code: 'not_found', message: '找不到对应章节' };
  const chapterId = String(chapter.id);
  const chapterVersion = await fetchChapterVersion(fetcher, auth.token, cfg, chapterId);

  if (params.checkpoint?.phase !== 'submitted') {
    if (isVideoGroup(base)) {
      let durations = new Map<string, any>();
      try {
        durations = await fetchVideoDurations(
          {
            token: auth.token,
            baseUrl: IPUB_BASE,
            bookId: cfg.bookId,
            bookVersionNumber: cfg.bookVersion,
          },
          fetcher,
        );
      } catch (error) {
        log('warn', `video durations failed: ${errorText(error)}`);
      }
      const durationMs = Number(durations.get(anchor)?.durationMs ?? 0);
      if (!durationMs) {
        return {
          status: 'unknown',
          reason: '无法获取视频时长',
          checkpoint: { phase: 'submitted' },
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
          durationMs,
        },
        fetcher,
      );
      log(
        'info',
        `finishNode video ${anchor} HTTP ${result.status} code ${(result.json as any)?.code ?? '?'}`,
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
          dwellMs: 60_000,
        },
        fetcher,
      );
      log(
        'info',
        `finishNode text ${anchor} type ${base} HTTP ${result.status} code ${(result.json as any)?.code ?? '?'}`,
      );
    } else {
      return { status: 'needs_human', reason: `未支持的类型 ${base}` };
    }
  }

  const leafs = await fetchUnitProgress(
    {
      token: auth.token,
      cookie: '',
      courseId: cfg.id,
      unit: String(found.unit.id),
      openId: auth.open_id,
      baseUrl: CONTENT_BASE,
    },
    fetcher,
  );
  const pass = Number(leafs?.[groupId]?.pass ?? 0);
  if (pass === 1) {
    return {
      status: 'completed',
      evidence: { platform_confirmed: true, pass },
      checkpoint: { phase: 'done' },
    };
  }
  return {
    status: 'in_progress',
    wait_ms: 2000,
    checkpoint: { phase: 'submitted' },
  };
}

async function dispatch(method, params) {
  switch (method) {
    case 'platform.describe':
      return describe(params);
    case 'auth.begin':
      return authBegin(params);
    case 'auth.submit':
      return authSubmit(params);
    case 'auth.poll':
      return authPoll(params);
    case 'auth.complete':
      return authComplete(params);
    case 'auth.verify':
      return authVerify(params);
    case 'auth.keepalive':
      return authKeepalive(params);
    case 'catalog.courses':
      return catalogCourses(params);
    case 'catalog.units':
      return catalogUnits(params);
    case 'catalog.papers':
      return catalogPapers(params);
    case 'exam.open':
      return examOpen(params);
    case 'exam.write':
      return examWrite(params);
    case 'exam.readback':
      return examReadback(params);
    case 'exam.review':
      return examReview(params);
    case 'exam.redo':
      return examOpen(params);
    case 'exam.heartbeat':
      return { ok: true };
    case 'study.step':
      return studyStep(params);
    default:
      throw { code: 'unsupported_operation', message: `U校园骨架未实现 ${method}` };
  }
}

async function handleRequest(request) {
  try {
    const result = await dispatch(request.method, request.params ?? {});
    write({ jsonrpc: '2.0', id: request.id, result: result ?? {} });
  } catch (error) {
    write({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: error?.code ?? 'module_error',
        message: error?.message ?? String(error),
      },
    });
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    log('warn', 'ignored non-JSON input');
    return;
  }
  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(message.error);
    else waiter.resolve(message.result);
    return;
  }
  if (typeof message.method === 'string' && message.id !== undefined) {
    void handleRequest(message);
  }
});

lines.on('close', () => {
  process.exit(0);
});
