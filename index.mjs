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

const SSO_BASE = 'https://sso.unipus.cn';
const UCONTENT_BASE = 'https://ucontent.unipus.cn';
const LOGIN_AES_KEY = Buffer.from('8AD70B641C024C7ADA2ECD082EC0334F', 'hex');
const LOGIN_AES_IV = Buffer.from('0102030405060708090A0B0C0D0E0F10', 'hex');
const ANNOTATOR_SECRET = 'a824b379f126b8b7aa5e33dee83fb0a05aa7462c';

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
  });

  const loginResponse = await hostCall('cw.net.fetch', {
    session,
    method: 'POST',
    url: `${SSO_BASE}/sso/0.1/sso/cip/login`,
    encoding: 'json',
    stage: 'read',
    headers: {
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
  await hostCall('cw.net.fetch', {
    session,
    method: 'GET',
    url: redeem,
    stage: 'read',
  });

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

async function catalogCourses(params) {
  const session = String(params.session ?? '');
  let smoke = smokeCache.get(session);
  if (!smoke) {
    smoke = await smokeFetch(session);
    smokeCache.set(session, smoke);
  }
  const courses = SOURCE === 'live'
    ? [
        {
          id: COURSE_ID || 'unipus-live',
          recruit_id: 'unipus-live',
          name: 'U校园（已登录）',
          kind: 'shared',
          kind_label: '共享课',
          family: 'shared',
          progress: null,
          outline_available: false,
        },
      ]
    : [
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
      ];
  return { courses, smoke };
}

function catalogUnits(params) {
  if (SOURCE === 'live') return { units: [] };
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

function studyStep(params) {
  if (SOURCE === 'live') {
    return {
      status: 'needs_human',
      reason: 'live 学习链路尚未实现；当前仅验证登录与目录',
    };
  }
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
