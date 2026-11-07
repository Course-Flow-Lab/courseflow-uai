import { buildSubmitSignature, readOpenId } from "./submit-signature.js";
import type { CourseTreeGroup, CourseTreeUnit } from "./video.js";

/**
 * `quiz-paper-link` challenges (`paperType: 2`).
 *
 * Unlike a Unit Test (`paperType: 3`) a challenge paper cannot be saved with
 * `saveUserPaperAnswer` ("仅常规卷和诊断卷支持保存作答记录"). The working order,
 * captured from the real reader on 2026-11-07:
 *
 *   1. createPaperInstanceByPublishedBook {bookId, bookVersionNumber, paperId}
 *   2. submitUserPaperAnswer {instanceId, paperType, userAnswerParamsMap, a, b}
 *   3. submitUserChallengeScore {paperId, versionNumber}
 *
 * Only step 3 flips the course leaf (`course_progress` pass=1).
 */

const DEFAULT_BASE_URL = "https://ipub.unipus.cn";

export interface QuizApiOptions {
  token: string;
  baseUrl?: string;
}

export interface QuizLink {
  unit: string;
  unitName: string;
  groupId: string;
  /** The link's `externalNodeId` is the published paperId. */
  paperId: string;
  title: string;
  done?: boolean;
}

export interface PublishedPaper {
  paperId: string;
  paperName?: string;
  paperType: number;
  versionNumber: string;
}

export function collectQuizLinks(units: CourseTreeUnit[]): QuizLink[] {
  const links: QuizLink[] = [];
  const walk = (unit: CourseTreeUnit, node: CourseTreeGroup) => {
    if (node.base === "quiz-paper-link" && node.externalNodeId) {
      links.push({
        unit: unit.id,
        unitName: unit.name ?? "",
        groupId: node.id,
        paperId: node.externalNodeId,
        title: (node.name ?? "Quiz").trim(),
      });
    }
    for (const child of node.children ?? []) walk(unit, child);
  };
  for (const unit of units) for (const child of unit.children ?? []) walk(unit, child);
  return links;
}

function authHeader(token: string): string {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function baseHeaders(token: string): Record<string, string> {
  return {
    authorization: authHeader(token),
    lovefrom: "learner",
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
  };
}

export async function fetchPublishedPaper(
  options: QuizApiOptions,
  ids: { bookId: string; bookVersionNumber: string; paperId: string },
  fetcher: typeof fetch = fetch,
): Promise<PublishedPaper> {
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/getPaperVersionByPublishedBook`,
    { method: "POST", headers: baseHeaders(options.token), body: JSON.stringify(ids) },
  );
  const json = (await response.json()) as {
    code?: number;
    message?: string;
    data?: PublishedPaper;
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(`fetchPublishedPaper: ${json.message ?? `code ${json.code}`}`);
  }
  return json.data;
}

export async function createChallengeInstance(
  options: QuizApiOptions,
  ids: { bookId: string; bookVersionNumber: string; paperId: string },
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/instance/createPaperInstanceByPublishedBook`,
    { method: "POST", headers: baseHeaders(options.token), body: JSON.stringify(ids) },
  );
  const json = (await response.json()) as {
    code?: number;
    message?: string;
    data?: Record<string, unknown>;
  };
  if (json.code !== 200 || !json.data) {
    throw new Error(`createChallengeInstance: ${json.message ?? `code ${json.code}`}`);
  }
  return json.data;
}

export interface ChallengeAnswerRecord {
  childId: string;
  questionType: string;
  userAnswerValue: string;
}

export interface ChallengeAnswerPayload {
  instanceId: string;
  paperType: number;
  userAnswerParamsMap: Record<string, ChallengeAnswerRecord[]>;
  a: number;
  b: number;
}

/** Step 2: submit answers. The challenge paper accepts them without saving first. */
export async function submitChallengeAnswers(
  options: QuizApiOptions & { referer: string },
  payload: ChallengeAnswerPayload,
  fetcher: typeof fetch = fetch,
): Promise<{ code?: number; message?: string; data?: { userScore?: number; standardScore?: number } }> {
  const timestamp = payload.a;
  const signature = buildSubmitSignature({
    authorization: authHeader(options.token),
    openId: readOpenId(options.token),
    referer: options.referer,
    timestamp,
  });
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/answer/submitUserPaperAnswer`,
    {
      method: "POST",
      headers: {
        ...baseHeaders(options.token),
        origin: "https://ipub.unipus.cn",
        referer: options.referer,
        "x-referer": options.referer,
        v: signature,
      },
      body: JSON.stringify(payload),
    },
  );
  return (await response.json()) as {
    code?: number;
    message?: string;
    data?: { userScore?: number; standardScore?: number };
  };
}

/** Step 3: submit the challenge score. This is what marks the course leaf done. */
export async function submitChallengeScore(
  options: QuizApiOptions & { referer?: string },
  ids: { paperId: string; versionNumber: string },
  fetcher: typeof fetch = fetch,
): Promise<{ code?: number; message?: string; data?: { status?: number; userScore?: number } }> {
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/paper/answer/submitUserChallengeScore`,
    {
      method: "POST",
      headers: {
        ...baseHeaders(options.token),
        ...(options.referer
          ? { origin: "https://ipub.unipus.cn", referer: options.referer, "x-referer": options.referer }
          : {}),
      },
      body: JSON.stringify(ids),
    },
  );
  return (await response.json()) as {
    code?: number;
    message?: string;
    data?: { status?: number; userScore?: number };
  };
}
