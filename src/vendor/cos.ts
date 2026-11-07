import { createHash, createHmac } from "node:crypto";

/**
 * Tencent COS upload for speaking answers.
 *
 * The reader stores recorded audio in COS: it asks `/api/cos/answer/getCOSCredential`
 * for temporary credentials and a `pathPrefix`, then PUTs the file straight to
 * the bucket. No browser involved, so the same flow works server-side.
 */

export interface CosCredential {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  /** e.g. https://ipublish-1313083974.cos.ap-beijing.myqcloud.com/ */
  domain: string;
  /** e.g. answer/<user>/<uuid>/ */
  pathPrefix: string;
  expiration?: string;
}

export interface CosApiOptions {
  token: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://ipub.unipus.cn";

function authHeader(token: string): string {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

/** Fetch temporary COS credentials for answer uploads. */
export async function fetchCosCredential(
  options: CosApiOptions,
): Promise<CosCredential> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/cos/answer/getCOSCredential`,
    {
      method: "GET",
      headers: {
        authorization: authHeader(options.token),
        lovefrom: "learner",
        accept: "application/json",
      },
    },
  );
  const json = (await response.json()) as {
    code?: number;
    message?: string;
    data?: Record<string, any>;
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(
      `COS credential failed: ${json.code} ${json.message ?? ""}`.trim(),
    );
  }
  const data = json.data;
  const required = ["tmpSecretId", "tmpSecretKey", "sessionToken", "domain"];
  for (const key of required) {
    if (!data[key]) throw new Error(`COS credential missing ${key}`);
  }
  return {
    tmpSecretId: String(data.tmpSecretId),
    tmpSecretKey: String(data.tmpSecretKey),
    sessionToken: String(data.sessionToken),
    domain: String(data.domain),
    pathPrefix: String(data.pathPrefix ?? ""),
    ...(data.expiration ? { expiration: String(data.expiration) } : {}),
  };
}

function sha1Hex(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

function hmacSha1Hex(key: string, value: string): string {
  return createHmac("sha1", key).update(value, "utf8").digest("hex");
}

export interface CosSignInput {
  method: string;
  /** Object path including a leading slash, already URL-encoded. */
  pathname: string;
  /** Lowercase header name -> value; `host` is required. */
  headers: Record<string, string>;
  secretId: string;
  secretKey: string;
  /** Unix seconds; defaults to now-60 .. now+1800. */
  startTime?: number;
  endTime?: number;
}

/**
 * Tencent COS XML-API signature.
 *
 * SignKey    = HMAC-SHA1(secretKey, keyTime)
 * HttpString = method \n pathname \n params \n headers \n
 * StringToSign = "sha1" \n signTime \n SHA1(HttpString) \n
 * Signature = HMAC-SHA1(SignKey, StringToSign)
 */
export function cosAuthorization(input: CosSignInput): string {
  const start = input.startTime ?? Math.floor(Date.now() / 1000) - 60;
  const end = input.endTime ?? Math.floor(Date.now() / 1000) + 1800;
  const keyTime = `${start};${end}`;
  const signTime = keyTime;

  const headerEntries = Object.entries(input.headers)
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const headerList = headerEntries.map(([name]) => name).join(";");
  const headerString = headerEntries
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");

  const httpString = [
    input.method.toLowerCase(),
    input.pathname,
    "",
    headerString,
    "",
  ].join("\n");

  const stringToSign = ["sha1", signTime, sha1Hex(httpString), ""].join("\n");
  const signKey = hmacSha1Hex(input.secretKey, keyTime);
  const signature = hmacSha1Hex(signKey, stringToSign);

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${input.secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    "q-url-param-list=",
    `q-signature=${signature}`,
  ].join("&");
}

export interface UploadCosObjectOptions {
  credential: CosCredential;
  /** Path inside the bucket, e.g. `answer/<user>/<id>/clip.wav`. */
  objectPath: string;
  body: Uint8Array;
  contentType?: string;
  fetcher?: typeof fetch;
}

export interface UploadCosObjectResult {
  ok: boolean;
  status: number;
  /** Public URL of the uploaded object. */
  url: string;
  etag?: string;
  body: string;
}

/** PUT one object into the answer bucket using the temporary credentials. */
export async function uploadCosObject(
  options: UploadCosObjectOptions,
): Promise<UploadCosObjectResult> {
  const fetcher = options.fetcher ?? fetch;
  const domain = options.credential.domain.replace(/\/+$/, "");
  const host = new URL(domain).host;
  const objectPath = options.objectPath.replace(/^\/+/, "");
  const pathname = `/${objectPath}`;
  const url = `${domain}/${objectPath}`;

  const authorization = cosAuthorization({
    method: "PUT",
    pathname,
    headers: { host },
    secretId: options.credential.tmpSecretId,
    secretKey: options.credential.tmpSecretKey,
  });

  const response = await fetcher(url, {
    method: "PUT",
    headers: {
      authorization,
      host,
      "x-cos-security-token": options.credential.sessionToken,
      "content-type": options.contentType ?? "audio/wav",
    },
    body: options.body as unknown as BodyInit,
  });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url,
    ...(response.headers.get("etag")
      ? { etag: response.headers.get("etag")! }
      : {}),
    body: body.slice(0, 500),
  };
}
