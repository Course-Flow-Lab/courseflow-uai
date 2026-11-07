/**
 * Speaking evaluation helpers (Aliyun SOE behind the platform's proxy).
 *
 * The WebSocket part lives in the framework's browser page (see module.ts):
 * a module cannot open raw sockets. These helpers cover the HTTP half:
 *   1. POST /api/reader/answer/getClioSig  -> applicationId / sig / timestamp / tokenId
 *   2. poll /api/reader/answer/getAnswerCallbackEvaluation for the platform's
 *      own copy of the evaluation
 *   3. build the `userAnswerValue` the reader submits
 */

export interface ClioSig {
  applicationId: string;
  sig: string;
  timestamp: number;
  userId: string;
  /** The platform's bizAnswerId for this recording. */
  tokenId: string;
}

export interface ClioSigOptions {
  token: string;
  bizQuestionId: string;
  questionType?: string;
  soeQuestionType?: number;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://ipub.unipus.cn";

function authHeader(token: string): string {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

export async function fetchClioSig(options: ClioSigOptions): Promise<ClioSig> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/answer/getClioSig`,
    {
      method: "POST",
      headers: {
        authorization: authHeader(options.token),
        lovefrom: "learner",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        bizQuestionId: options.bizQuestionId,
        questionType: options.questionType ?? "oral_personal_state",
        soeQuestionType: options.soeQuestionType ?? 77,
      }),
    },
  );
  const json = (await response.json()) as {
    code?: number;
    message?: string;
    data?: Record<string, any>;
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(`getClioSig failed: ${json.code} ${json.message ?? ""}`.trim());
  }
  const data = json.data;
  return {
    applicationId: String(data.applicationId),
    sig: String(data.sig),
    timestamp: Number(data.timestamp),
    userId: String(data.userId),
    tokenId: String(data.tokenId),
  };
}

export interface SpeechScore {
  /** 0-100 overall. */
  total: number;
  audioTime: number;
  accuracy: number;
  fluency: number;
  relevance: number;
  transcript: string;
  conclusion: string;
  raw: unknown;
}

export interface WaitEvaluationOptions {
  token: string;
  bizAnswerId: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  intervalMs?: number;
  maxAttempts?: number;
}

/**
 * Wait until the platform's own callback holds the evaluation.
 *
 * The reader submits only after this becomes non-null; submitting earlier is
 * rejected with `500 无效的用户作答`.
 */
export async function waitForAnswerEvaluation(
  options: WaitEvaluationOptions,
): Promise<string | null> {
  const fetcher = options.fetcher ?? fetch;
  const interval = options.intervalMs ?? 1_500;
  const attempts = options.maxAttempts ?? 20;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const url =
      `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/answer/getAnswerCallbackEvaluation` +
      `?bizAnswerId=${encodeURIComponent(options.bizAnswerId)}`;
    try {
      const response = await fetcher(url, {
        headers: {
          authorization: authHeader(options.token),
          lovefrom: "learner",
          accept: "application/json",
        },
      });
      const json = (await response.json()) as {
        code?: number;
        data?: { evaluation?: string | null; resultFlg?: boolean };
      };
      const evaluation = json.data?.evaluation;
      if (typeof evaluation === "string" && evaluation.length > 0) {
        return evaluation;
      }
    } catch {
      // network hiccup: keep polling
    }
    if (attempt < attempts - 1) {
      await new Promise((done) => setTimeout(done, interval));
    }
  }
  return null;
}

/**
 * Parse the `evaluation` JSON returned by `getAnswerCallbackEvaluation`.
 *
 * This is the platform's own copy of the result, so it is the authoritative
 * source for the numbers embedded in `userAnswerValue`.
 */
export function speechScoreFromEvaluation(evaluation: string): SpeechScore | null {
  let json: any;
  try {
    json = JSON.parse(evaluation);
  } catch {
    return null;
  }
  const result = json?.finalResult?.result ?? json?.result;
  if (!result) return null;
  const extra = result.extra_details ?? {};
  const multi = extra.multi_dim_score ?? {};
  return {
    total: Number(result.total ?? 0),
    audioTime: Number(result.audio_time ?? 0),
    accuracy: Number(multi.accuracy ?? 0),
    fluency: Number(multi.fluency ?? 0),
    relevance: Number(multi.relevance ?? 0),
    transcript: String(result.asr_detail ?? ""),
    conclusion: String(extra?.multi_dim_feedback?.conclusion ?? ""),
    raw: json,
  };
}

/** `userAnswerValue` payload the reader submits for a speaking task. */
export function buildOralAnswerValue(
  score: SpeechScore,
  audioUrl: string,
  bizAnswerId: string,
): string {
  return JSON.stringify({
    score: Math.round(score.total),
    smooth: Math.round(score.fluency),
    completed: 0,
    correctness: Math.round(score.accuracy),
    details: [],
    audioUrl,
    type: "EN_ASR_REC",
    bizAnswerId,
    relevance: Math.round(score.relevance),
    duration: Math.round(score.audioTime * 1000),
    conclusion: score.conclusion,
    wordDetails: [],
  });
}
