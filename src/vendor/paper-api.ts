import type { PaperData } from "./paper.js";
import type { Answer } from "./types.js";
import { buildSubmitSignature, readOpenId } from "./submit-signature.js";

export interface PaperAnswerRecord {
  childId: string;
  questionType: string;
  userAnswerValue: string;
}

export interface PaperSavePayload {
  instanceId: string;
  paperType: number;
  testMode: number;
  baseInstanceId: string;
  userAnswerParamsMap: Record<string, PaperAnswerRecord[]>;
}

export interface PaperApiOptions {
  token: string;
  baseUrl?: string;
  testMode?: number;
}

export interface CreatePaperOptions extends PaperApiOptions {
  bookId: string;
  bookVersionNumber: string;
  paperId: string;
  versionNumber: string;
  chapterVersionNumber?: string;
}

export interface SubmitPaperOptions extends PaperApiOptions {
  answers: Answer[];
  /** Exam page URL; also used as `referer` and `x-referer`. */
  referer: string;
  /** Optional openId override; otherwise decoded from the reader token. */
  openId?: string;
}

export interface PaperApiResult {
  status: number;
  body: string;
}

const DEFAULT_BASE_URL = "https://ipub.unipus.cn";

function headers(token: string): Record<string, string> {
  return {
    authorization: /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`,
    lovefrom: "learner",
    "content-type": "application/json",
  };
}

/**
 * Convert solver answers into the exact map used by
 * `/api/reader/paper/answer/saveUserPaperAnswer`.
 *
 * Single/multiple/judge answers become a JSON string array of optionIds;
 * fill/translation answers stay as plain text.
 */
export function buildPaperAnswerMap(
  paper: PaperData,
  answers: Answer[],
): Record<string, PaperAnswerRecord[]> {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const map: Record<string, PaperAnswerRecord[]> = {};

  for (const question of paper.questions) {
    const answer = byId.get(question.id);
    const texts = answer?.texts ?? [];
    const records: PaperAnswerRecord[] = [];

    if (
      question.type === "single" ||
      question.type === "multiple" ||
      question.type === "judge"
    ) {
      const optionIds = texts
        .map(
          (text) =>
            question.options.find((option) => option.text === text)?.value ??
            "",
        )
        .filter(Boolean);
      records.push({
        childId: question.childId ?? "",
        questionType: question.rawType,
        userAnswerValue: JSON.stringify(optionIds),
      });
    } else {
      const childIds = question.childIds ?? [];
      if (childIds.length > 1) {
        // One record per blank, in the order the solver returned the texts.
        childIds.forEach((childId, index) => {
          records.push({
            childId,
            questionType: question.rawType,
            userAnswerValue: texts[index] ?? "",
          });
        });
      } else {
        records.push({
          childId: question.childId ?? "",
          questionType: question.rawType,
          userAnswerValue: texts.join("\n"),
        });
      }
    }

    // Multiple questions can share a group (e.g. a reading set); append.
    map[question.groupId] = [...(map[question.groupId] ?? []), ...records];
  }

  return map;
}

export function buildPaperSavePayload(
  paper: PaperData,
  answers: Answer[],
  testMode = 1,
): PaperSavePayload {
  if (!paper.instanceId) {
    throw new Error("paper.instanceId is required for saving answers");
  }
  return {
    instanceId: paper.instanceId,
    paperType: paper.paperType,
    testMode,
    baseInstanceId: paper.instanceId,
    userAnswerParamsMap: buildPaperAnswerMap(paper, answers),
  };
}

/** Create a real paper instance (starts a Unit Test attempt). */
export async function createPaperInstance(
  options: CreatePaperOptions,
): Promise<PaperApiResult> {
  const response = await fetch(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/instance/createPaperInstanceByPublishedBook`,
    {
      method: "POST",
      headers: headers(options.token),
      body: JSON.stringify({
        bookId: options.bookId,
        bookVersionNumber: options.bookVersionNumber,
        paperId: options.paperId,
        versionNumber: options.versionNumber,
        ...(options.chapterVersionNumber
          ? { chapterVersionNumber: options.chapterVersionNumber }
          : {}),
        testMode: options.testMode ?? 1,
      }),
    },
  );
  return { status: response.status, body: await response.text() };
}

export async function savePaperAnswers(
  options: PaperApiOptions,
  paper: PaperData,
  answers: Answer[],
): Promise<PaperApiResult> {
  const payload = buildPaperSavePayload(
    paper,
    answers,
    options.testMode ?? 1,
  );
  const response = await fetch(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/answer/saveUserPaperAnswer`,
    {
      method: "POST",
      headers: headers(options.token),
      body: JSON.stringify(payload),
    },
  );
  return { status: response.status, body: await response.text() };
}

export interface PaperSubmitPayload extends Omit<PaperSavePayload, "testMode"> {
  testMode: number;
  async: true;
  a: number;
  b: number;
}

export function buildPaperSubmitPayload(
  paper: PaperData,
  answers: Answer[],
  testMode = 1,
  timestamp = Date.now(),
): PaperSubmitPayload {
  if (!paper.instanceId) {
    throw new Error("paper.instanceId is required for submitting");
  }
  return {
    instanceId: paper.instanceId,
    paperType: paper.paperType,
    testMode,
    baseInstanceId: paper.instanceId,
    userAnswerParamsMap: buildPaperAnswerMap(paper, answers),
    async: true,
    a: timestamp,
    b: timestamp,
  };
}

export interface PaperAnswerState {
  code?: number;
  message?: string;
  submitStatus?: number;
  totalScore?: number;
  correctAnswers?: unknown[];
}

export interface LatestPaperOptions extends PaperApiOptions {
  bookId: string;
  bookVersionNumber: string;
  paperId: string;
  versionNumber: string;
  paperType?: number;
  chapterVersionNumber?: string;
}

export interface PaperInstanceResult {
  status: number;
  body: string;
  data?: Record<string, any>;
}

/**
 * Fetch the latest attempt for a paper.
 *
 * Returns the submitted instance too, so callers must check `getPaperScore`
 * before deciding whether to resume or to start a new attempt.
 */
export async function getLatestPaperInstance(
  options: LatestPaperOptions,
): Promise<PaperInstanceResult> {
  const response = await fetch(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/instance/getLatestPaperInstance`,
    {
      method: "POST",
      headers: headers(options.token),
      body: JSON.stringify({
        bookId: options.bookId,
        bookVersionNumber: options.bookVersionNumber,
        paperId: options.paperId,
        versionNumber: options.versionNumber,
        paperType: options.paperType ?? 3,
        testMode: options.testMode ?? 1,
        ...(options.chapterVersionNumber
          ? { chapterVersionNumber: options.chapterVersionNumber }
          : {}),
      }),
    },
  );
  const body = await response.text();
  let data: Record<string, any> | undefined;
  try {
    const json = JSON.parse(body) as { code?: number; data?: Record<string, any> };
    if (json.code === 200 && json.data) data = json.data;
  } catch {
    data = undefined;
  }
  return {
    status: response.status,
    body,
    ...(data ? { data } : {}),
  };
}

export interface PaperScoreSummary {
  code?: number;
  message?: string;
  status?: number;
  paperScore?: {
    userScore?: number;
    standardScore?: number;
    correctRate?: number;
    scoringRate?: number;
    correctCount?: number;
    incorrectCount?: number;
    totalCount?: number;
    scoreLevel?: string;
  };
}

/**
 * Read the normalized paper score. This is the authoritative finalize signal:
 * `status === 1` means the attempt was accepted, while
 * `getUserPaperAnswer.submitStatus` can lag or return 0 right after submitting.
 */
export async function getPaperScore(
  options: PaperApiOptions,
  paper: PaperData,
): Promise<PaperScoreSummary> {
  if (!paper.instanceId) {
    throw new Error("paper.instanceId is required to read the score");
  }
  const response = await fetch(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/answer/getUserPaperScore`,
    {
      method: "POST",
      headers: headers(options.token),
      body: JSON.stringify({
        instanceId: paper.instanceId,
        paperId: paper.paperId,
        versionNumber: paper.versionNumber,
        paperType: paper.paperType,
        testMode: options.testMode ?? 1,
      }),
    },
  );
  const json = (await response.json()) as {
    code?: number;
    message?: string;
    data?: Omit<PaperScoreSummary, "code" | "message">;
  };
  return {
    code: json.code,
    message: json.message,
    status: json.data?.status,
    ...(json.data?.paperScore ? { paperScore: json.data.paperScore } : {}),
  };
}

/** Read the server-side answer/submit state for a paper instance. */
export async function getPaperAnswerState(
  options: PaperApiOptions,
  paper: PaperData,
): Promise<PaperAnswerState> {
  if (!paper.instanceId) {
    throw new Error("paper.instanceId is required to read the answer state");
  }
  const response = await fetch(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/answer/getUserPaperAnswer`,
    {
      method: "POST",
      headers: headers(options.token),
      body: JSON.stringify({
        instanceId: paper.instanceId,
        paperId: paper.paperId,
        versionNumber: paper.versionNumber,
        paperType: paper.paperType,
        testMode: options.testMode ?? 1,
      }),
    },
  );
  const json = (await response.json()) as {
    code?: number;
    message?: string;
    data?: {
      submitStatus?: number;
      totalScore?: number;
      correctAnswers?: unknown[];
    };
  };
  return {
    code: json.code,
    message: json.message,
    submitStatus: json.data?.submitStatus,
    totalScore: json.data?.totalScore,
    correctAnswers: json.data?.correctAnswers,
  };
}

/**
 * Submit a paper with the reader app's anti-automation envelope.
 *
 * The endpoint rejects plain requests with `417 涉嫌非法工具`; it requires a
 * short-lived `v` header derived from the Authorization header, exam URL,
 * openId and millisecond timestamp. See `submit-signature.ts`.
 */
export async function submitPaper(
  options: SubmitPaperOptions,
  paper: PaperData,
): Promise<PaperApiResult> {
  const authorization = /^Bearer\s/i.test(options.token)
    ? options.token
    : `Bearer ${options.token}`;
  const timestamp = Date.now();
  const payload = buildPaperSubmitPayload(
    paper,
    options.answers,
    options.testMode ?? 1,
    timestamp,
  );
  const openId = options.openId ?? readOpenId(authorization);
  const signature = buildSubmitSignature({
    authorization,
    openId,
    referer: options.referer,
    timestamp,
  });
  const response = await fetch(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/answer/submitUserPaperAnswer`,
    {
      method: "POST",
      headers: {
        authorization,
        lovefrom: "learner",
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "accept-language": "zh-CN",
        origin: "https://ipub.unipus.cn",
        referer: options.referer,
        "x-referer": options.referer,
        v: signature,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        "sec-ch-ua": '"Not:A-Brand";v="8", "Chromium";v="156"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
      },
      body: JSON.stringify(payload),
    },
  );
  return { status: response.status, body: await response.text() };
}
