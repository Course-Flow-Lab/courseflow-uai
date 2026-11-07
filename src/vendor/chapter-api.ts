import {
  loadChapterStructure,
  type ChapterStructure,
} from "./chapter-structure.js";
import { matchOption } from "./matcher.js";
import { classifyQuestion } from "./question-kind.js";
import { buildSubmitSignature, readOpenId } from "./submit-signature.js";
import type { Answer, Question } from "./types.js";

/**
 * Protocol-first chapter reader client.
 *
 * Everything here is plain HTTP: no browser, no Playwright, no DOM. The request
 * shapes were captured from the real reader and the `v` header is the same
 * HOTP scheme used by the Unit Test submit endpoint.
 */

const DEFAULT_BASE_URL = "https://ipub.unipus.cn";

export interface ChapterApiOptions {
  token: string;
  baseUrl?: string;
}

export interface ChapterIdentifiers {
  bookId: string;
  bookVersionNumber: string;
  chapterId: string;
}

export interface ChapterStructureResult {
  structure: ChapterStructure;
  chapterVersionNumber?: string;
  /** Raw `getChapterInfo.data` for debugging/telemetry. */
  raw: Record<string, unknown>;
}

export interface ChapterUserAnswer {
  childId: string;
  questionType: string;
  userAnswerValue: string;
  /** Only included by the AI-grading (`judgeStart`) payload. */
  questionId?: string;
  /**
   * Speaking answers carry the evaluation token on the record itself, not only
   * inside `userAnswerValue`; without it `submitScore` answers `无效的用户作答`.
   */
  bizAnswerId?: string;
}

export type ChapterSubmissionMode = "score" | "judge";

export interface ChapterGroupSubmission {
  groupId: string;
  versionNumber: string;
  /** `judge` groups must go through `judgeStart`, not `submitScore`. */
  mode: ChapterSubmissionMode;
  userAnswers: ChapterUserAnswer[];
}

export interface ChapterSubmitMeta extends ChapterIdentifiers {
  chapterVersionNumber: string;
  /** Reader chapter URL; used as `x-referer` and inside the `v` key. */
  referer: string;
  openId?: string;
  /** Millisecond timestamp sent as `a`/`b`; defaults to now. */
  timestamp?: number;
  /** Optional `b` override (finishNode uses a start/end pair). */
  endTimestamp?: number;
}

export interface ChapterApiResult<T = unknown> {
  status: number;
  ok: boolean;
  body: string;
  json?: T;
  /** Exact request body that was sent (or would have been sent). */
  payload: unknown;
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

function signedHeaders(
  token: string,
  referer: string,
  timestamp: number,
  openId?: string,
): Record<string, string> {
  const authorization = authHeader(token);
  const v = buildSubmitSignature({
    authorization,
    openId: openId ?? readOpenId(token),
    referer,
    timestamp,
  });
  return {
    ...baseHeaders(token),
    "x-referer": referer,
    v,
  };
}

/** Build the reader chapter URL the platform itself uses as referer. */
export function buildChapterReferer(ids: ChapterIdentifiers): string {
  return (
    `https://ipub.unipus.cn/learner/textbook/book/${ids.bookId}` +
    `/chapter/${ids.chapterId}?bookVersionNumber=${ids.bookVersionNumber}`
  );
}

function chapterVersionFromContent(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const match = content.match(/\/([^/]+)\/studentContent\.json/);
  return match?.[1];
}

/**
 * `GET /api/reader/chapter/getChapterInfo` + the signed `studentContent.json`
 * URL it returns. This replaces the browser `getChapterInfo` response capture.
 */
export async function fetchChapterStructure(
  options: ChapterApiOptions,
  ids: ChapterIdentifiers,
  fetcher: typeof fetch = fetch,
): Promise<ChapterStructureResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const query = new URLSearchParams({
    bookId: ids.bookId,
    bookVersionNumber: ids.bookVersionNumber,
    chapterId: ids.chapterId,
  });
  const response = await fetcher(
    `${baseUrl}/api/reader/chapter/getChapterInfo?${query.toString()}`,
    { headers: baseHeaders(options.token) },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `getChapterInfo failed: HTTP ${response.status} ${text.slice(0, 200)}`,
    );
  }
  const json = JSON.parse(text) as { code?: number; data?: Record<string, any> };
  if (json.code !== undefined && json.code !== 200) {
    throw new Error(
      `getChapterInfo rejected: code ${json.code} ${text.slice(0, 200)}`,
    );
  }
  const data = json.data ?? {};
  const structure = await loadChapterStructure(data, fetcher);
  const chapterVersionNumber =
    (data.chapterVersionNumber ? String(data.chapterVersionNumber) : undefined) ??
    (data.versionNumber ? String(data.versionNumber) : undefined) ??
    chapterVersionFromContent(data.content);
  return {
    structure,
    ...(chapterVersionNumber ? { chapterVersionNumber } : {}),
    raw: data,
  };
}

function optionIdOf(question: Question, text: string): string | undefined {
  const match = matchOption(text, question.options);
  if (!match) return undefined;
  return match.option.optionId ?? match.option.value;
}

/** Types graded by AI; the reader sends these to `judgeStart`, not `submitScore`. */
const AI_GRADED = new Set([
  "writing",
  "short_answer",
  "translation",
  "oral_personal_state",
]);

/**
 * Which answer types go to `judgeStart`.
 *
 * Some fill-in groups hold long free-text answers that `submitScore` stores but
 * never grades (`status: 0`, `score: null`); the caller can escalate those by
 * passing their type explicitly.
 */
function judgeable(extraTypes?: string[]): Set<string> {
  if (!extraTypes || extraTypes.length === 0) return AI_GRADED;
  return new Set([...AI_GRADED, ...extraTypes]);
}

/**
 * Convert solver answers into per-group payload pieces.
 *
 * Encoding observed on the real endpoints:
 * - `single_choice` / `multiple_choice` / `text_match`: JSON array of option ids
 * - `true_false`: a bare option id string (NOT an array)
 * - `fill_blanks` / `fill_blanks_choice` / text types: plain string
 * - every child of a group is present; unanswered children are sent as ""
 * - groups with an answered AI-graded question use `judgeStart`
 */
export function buildChapterSubmissions(
  questions: Question[],
  answers: Answer[],
): { submissions: ChapterGroupSubmission[]; warnings: string[] } {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const groups = new Map<string, ChapterGroupSubmission>();
  const warnings: string[] = [];

  const merge = (
    question: Question,
    records: ChapterUserAnswer[],
  ): void => {
    const groupId = question.groupId!;
    const versionNumber = question.groupVersion!;
    const answeredJudge = records.some(
      (record) =>
        record.userAnswerValue !== "" &&
        AI_GRADED.has(record.questionType) &&
        // Zero-point questions (short_answer / discussion prompts) are never
        // AI-graded by the platform: `judgeStart` answers with an empty
        // `judgeTaskList`, and the answer only needs a plain `submitScore`.
        question.score !== 0,
    );
    if (
      question.score === 0 &&
      records.some(
        (record) =>
          record.userAnswerValue !== "" && AI_GRADED.has(record.questionType),
      )
    ) {
      warnings.push(
        `${question.id}: 0-point ${question.rawType ?? question.type}; submitted without AI grading`,
      );
    }

    const existing = groups.get(groupId);
    if (!existing) {
      groups.set(groupId, {
        groupId,
        versionNumber,
        mode: answeredJudge ? "judge" : "score",
        userAnswers: records,
      });
      return;
    }
    if (existing.versionNumber !== versionNumber) {
      warnings.push(
        `${question.id}: group version mismatch (${existing.versionNumber} != ${versionNumber})`,
      );
    }
    if (answeredJudge) existing.mode = "judge";
    existing.userAnswers.push(...records);
  };

  const pushAll = (
    question: Question,
    values: Array<{ childId: string; value: string }>,
  ): void => {
    merge(
      question,
      values.map(({ childId, value }) => ({
        childId,
        questionType: question.rawType ?? question.type,
        userAnswerValue: value,
        questionId: question.id,
      })),
    );
  };

  for (const question of questions) {
    if (!question.groupId || !question.groupVersion) {
      warnings.push(`${question.id}: missing groupId/versionNumber`);
      continue;
    }

    const questionType = question.rawType ?? question.type;
    const kind = classifyQuestion(questionType);
    const childIds = question.childIds ?? [];
    const blankIds =
      childIds.length > 0
        ? childIds
        : (question.blanks ?? [])
            .map((blank) => blank.id)
            .filter((id): id is string => Boolean(id));

    const answer = byId.get(question.id);
    const answered = Boolean(answer && answer.texts.length > 0);

    // Unanswered: mirror the reader and send every child with an empty value.
    if (!answered) {
      const emptyIds =
        kind.answerMode === "pairs"
          ? (question.pairs ?? [])
              .map((pair) => pair.id)
              .filter((id): id is string => Boolean(id))
          : blankIds.length > 0
            ? blankIds
            : [question.id];
      pushAll(
        question,
        emptyIds.map((childId) => ({ childId, value: "" })),
      );
      continue;
    }

    const texts = answer!.texts;

    if (kind.answerMode === "option") {
      const ids = texts
        .map((text) => optionIdOf(question, text))
        .filter((id): id is string => Boolean(id));
      if (ids.length === 0) {
        warnings.push(
          `${question.id}: no option id matched [${texts.join(" | ")}]`,
        );
        continue;
      }
      const value =
        questionType === "true_false" ? (ids[0] ?? "") : JSON.stringify(ids);
      pushAll(question, [{ childId: blankIds[0] ?? question.id, value }]);
      continue;
    }

    if (kind.answerMode === "pairs") {
      const pairs = question.pairs ?? [];
      const values: Array<{ childId: string; value: string }> = [];
      for (let index = 0; index < pairs.length; index += 1) {
        const pair = pairs[index]!;
        if (!pair.id) continue;
        const text = texts[index];
        if (!text) {
          values.push({ childId: pair.id, value: "" });
          continue;
        }
        const optionId = optionIdOf(question, text);
        if (!optionId) {
          warnings.push(
            `${question.id}: pair ${index + 1} "${text}" did not match any option`,
          );
          values.push({ childId: pair.id, value: "" });
          continue;
        }
        values.push({ childId: pair.id, value: JSON.stringify([optionId]) });
      }
      pushAll(question, values);
      continue;
    }

    if (kind.answerMode === "blanks") {
      if (blankIds.length === 0) {
        warnings.push(`${question.id}: no blank ids`);
        continue;
      }
      pushAll(
        question,
        blankIds.map((childId, index) => ({
          childId,
          value: texts[index] ?? "",
        })),
      );
      continue;
    }

    if (kind.answerMode === "text") {
      pushAll(question, [
        { childId: blankIds[0] ?? question.id, value: texts.join("\n") },
      ]);
      continue;
    }

    // Nothing fillable (discussion/oral/upload): keep children so the group
    // stays complete, but they will be empty and filtered out if alone.
    pushAll(
      question,
      (blankIds.length > 0 ? blankIds : [question.id]).map((childId) => ({
        childId,
        value: "",
      })),
    );
  }

  const submissions: ChapterGroupSubmission[] = [];
  for (const group of groups.values()) {
    if (!group.userAnswers.some((record) => record.userAnswerValue !== "")) {
      warnings.push(`${group.groupId}: no answered questions; skipped`);
      continue;
    }
    submissions.push(group);
  }

  return { submissions, warnings };
}

export function buildChapterSubmitPayload(
  meta: ChapterSubmitMeta,
  submission: ChapterGroupSubmission,
): Record<string, unknown> {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  return {
    groupId: submission.groupId,
    userAnswers: submission.userAnswers.map(
      ({ childId, questionType, userAnswerValue, bizAnswerId }) => ({
        childId,
        questionType,
        userAnswerValue,
        ...(bizAnswerId ? { bizAnswerId } : {}),
      }),
    ),
    versionNumber: submission.versionNumber,
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersionNumber,
    chapterId: meta.chapterId,
    chapterVersionNumber: meta.chapterVersionNumber,
    a,
    b,
  };
}

/** Payload for AI-graded groups (`POST /api/reader/answer/judgeStart`). */
export function buildChapterJudgePayload(
  meta: ChapterSubmitMeta,
  submission: ChapterGroupSubmission,
  extraTypes?: string[],
): Record<string, unknown> {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  const allowed = judgeable(extraTypes);
  return {
    groupId: submission.groupId,
    lan: "en",
    userAnswers: submission.userAnswers.filter(
      (record) => allowed.has(record.questionType) && record.userAnswerValue !== "",
    ),
    versionNumber: submission.versionNumber,
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersionNumber,
    chapterId: meta.chapterId,
    chapterVersionNumber: meta.chapterVersionNumber,
    a,
    b,
  };
}

export function buildChapterJudgeResultPayload(
  submission: ChapterGroupSubmission,
  bizAnswerIds: Record<string, string>,
  extraTypes?: string[],
): Record<string, unknown> {
  const allowed = judgeable(extraTypes);
  const userAnswers = submission.userAnswers
    .filter(
      (record) =>
        allowed.has(record.questionType) &&
        record.userAnswerValue !== "" &&
        bizAnswerIds[record.childId],
    )
    .map((record) => ({
      questionId: record.questionId,
      childId: record.childId,
      questionType: record.questionType,
      userAnswerValue: record.userAnswerValue,
      bizAnswerId: bizAnswerIds[record.childId],
    }));
  return { userAnswers, versionNumber: submission.versionNumber };
}

/** Final `submitScore` body for a judged group: carries `bizAnswerId` per answer. */
export function buildChapterJudgeSubmitPayload(
  meta: ChapterSubmitMeta,
  submission: ChapterGroupSubmission,
  bizAnswerIds: Record<string, string>,
): Record<string, unknown> {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  return {
    groupId: submission.groupId,
    versionNumber: submission.versionNumber,
    userAnswers: submission.userAnswers.map((record) => {
      const bizAnswerId = bizAnswerIds[record.childId];
      return {
        childId: record.childId,
        questionType: record.questionType,
        userAnswerValue: record.userAnswerValue,
        ...(bizAnswerId
          ? {
              ...(record.questionId ? { questionId: record.questionId } : {}),
              bizAnswerId,
            }
          : {}),
      };
    }),
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersionNumber,
    chapterId: meta.chapterId,
    chapterVersionNumber: meta.chapterVersionNumber,
    a,
    b,
  };
}

async function postJson<T>(
  options: ChapterApiOptions,
  path: string,
  meta: ChapterSubmitMeta,
  payload: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<ChapterApiResult<T>> {
  const a = Number(payload.a ?? Date.now());
  const response = await fetcher(`${options.baseUrl ?? DEFAULT_BASE_URL}${path}`, {
    method: "POST",
    headers: signedHeaders(options.token, meta.referer, a, meta.openId),
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  let json: T | undefined;
  try {
    json = JSON.parse(body) as T;
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
    ...(json !== undefined ? { json } : {}),
    payload,
  };
}

/** `POST /api/reader/answer/submitScore` for one question group. */
export async function submitChapterScore<T = unknown>(
  options: ChapterApiOptions,
  meta: ChapterSubmitMeta,
  submission: ChapterGroupSubmission,
  fetcher: typeof fetch = fetch,
): Promise<ChapterApiResult<T>> {
  return postJson<T>(
    options,
    "/api/reader/answer/submitScore",
    meta,
    buildChapterSubmitPayload(meta, submission),
    fetcher,
  );
}

export interface ChapterJudgeTask {
  childId: string;
  bizAnswerId: string;
}

export interface ChapterJudgeResultItem {
  childId?: string;
  bizAnswerId?: string;
  status?: number;
  score?: number | null;
  evaluation?: string | null;
}

export interface ChapterJudgeOptions {
  fetcher?: typeof fetch;
  /** Delay between `judgeResult` polls. */
  pollIntervalMs?: number;
  /** Maximum number of polls before giving up. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Extra answer types to send to `judgeStart`.
   *
   * Used when a group is worth points but `submitScore` leaves it ungraded
   * (`status: 0`, `score: null`), which happens with long free-text fills.
   */
  extraQuestionTypes?: string[];
}

export interface ChapterJudgeOutcome {
  judgeTaskList: ChapterJudgeTask[];
  results: ChapterJudgeResultItem[];
  score?: number;
  polls: number;
  warnings: string[];
  responses: {
    start?: ChapterApiResult<unknown>;
    result?: ChapterApiResult<unknown>;
    score?: ChapterApiResult<unknown>;
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

/**
 * Run the AI-grading chain observed on the real reader:
 *   judgeStart -> poll judgeResult -> submitScore (with bizAnswerId)
 *
 * Only AI-graded answers are sent to `judgeStart`; the final `submitScore`
 * still carries the whole group so objective siblings stay complete.
 */
export async function submitChapterJudge(
  options: ChapterApiOptions,
  meta: ChapterSubmitMeta,
  submission: ChapterGroupSubmission,
  judgeOptions: ChapterJudgeOptions = {},
): Promise<ChapterJudgeOutcome> {
  const fetcher = judgeOptions.fetcher ?? fetch;
  const sleep =
    judgeOptions.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollIntervalMs = judgeOptions.pollIntervalMs ?? 1_500;
  const maxAttempts = judgeOptions.maxAttempts ?? 20;
  const warnings: string[] = [];
  const responses: ChapterJudgeOutcome["responses"] = {};

  const judgeSubmission: ChapterGroupSubmission = {
    ...submission,
    userAnswers: submission.userAnswers.filter(
      (record) =>
        judgeable(judgeOptions.extraQuestionTypes).has(record.questionType) &&
        record.userAnswerValue !== "",
    ),
  };
  if (judgeSubmission.userAnswers.length === 0) {
    const score = await submitChapterScore(options, meta, submission, fetcher);
    responses.score = score;
    return {
      judgeTaskList: [],
      results: [],
      ...(typeof asRecord(score.json).data?.score === "number"
        ? { score: asRecord(score.json).data.score as number }
        : {}),
      polls: 0,
      warnings: ["no AI-graded answers; used submitScore directly"],
      responses,
    };
  }

  const start = await postJson<Record<string, unknown>>(
    options,
    "/api/reader/answer/judgeStart",
    meta,
    buildChapterJudgePayload(
      meta,
      judgeSubmission,
      judgeOptions.extraQuestionTypes,
    ),
    fetcher,
  );
  responses.start = start;
  if (!start.ok) {
    warnings.push(`judgeStart failed: HTTP ${start.status} ${start.body.slice(0, 160)}`);
    return { judgeTaskList: [], results: [], polls: 0, warnings, responses };
  }

  const taskList = asRecord(asRecord(start.json).data).judgeTaskList;
  const judgeTaskList: ChapterJudgeTask[] = Array.isArray(taskList)
    ? taskList
        .map((task: any) => ({
          childId: String(task?.childId ?? ""),
          bizAnswerId: String(task?.bizAnswerId ?? ""),
        }))
        .filter((task) => task.childId && task.bizAnswerId)
    : [];
  const bizAnswerIds: Record<string, string> = {};
  for (const task of judgeTaskList) bizAnswerIds[task.childId] = task.bizAnswerId;
  if (judgeTaskList.length === 0) {
    warnings.push("judgeStart returned no judgeTaskList");
  }

  let results: ChapterJudgeResultItem[] = [];
  let polls = 0;
  for (
    let attempt = 0;
    judgeTaskList.length > 0 && attempt < maxAttempts;
    attempt += 1
  ) {
    await sleep(pollIntervalMs);
    const poll = await postJson<Record<string, unknown>>(
      options,
      "/api/reader/answer/judgeResult",
      meta,
      buildChapterJudgeResultPayload(
        judgeSubmission,
        bizAnswerIds,
        judgeOptions.extraQuestionTypes,
      ),
      fetcher,
    );
    polls += 1;
    responses.result = poll;
    if (!poll.ok) {
      warnings.push(`judgeResult failed: HTTP ${poll.status}`);
      break;
    }
    const items = asRecord(asRecord(poll.json).data).userAnswersResult;
    if (Array.isArray(items) && items.length > 0) {
      results = items as ChapterJudgeResultItem[];
      const done = results.every(
        (item) => Boolean(item.evaluation) || (item.status ?? 0) !== 0,
      );
      if (done) break;
    }
  }
  if (results.length > 0 && !results.every((item) => Boolean(item.evaluation))) {
    warnings.push("judgeResult did not return an evaluation before timeout");
  }

  const score = await postJson<Record<string, unknown>>(
    options,
    "/api/reader/answer/submitScore",
    meta,
    buildChapterJudgeSubmitPayload(meta, submission, bizAnswerIds),
    fetcher,
  );
  responses.score = score;
  if (!score.ok) {
    warnings.push(`submitScore failed: HTTP ${score.status}`);
  }
  const scoreValue = asRecord(asRecord(score.json).data).score;
  return {
    judgeTaskList,
    results,
    ...(typeof scoreValue === "number" ? { score: scoreValue } : {}),
    polls,
    warnings,
    responses,
  };
}

export interface ChapterNodeRef {
  nodeId: string;
  nodeType: string;
}/** One answer slot as returned by `GET /api/reader/answer/list`. */
export interface ChapterAnswerListChild {
  childId?: string;
  userAnswerValue?: string | null;
  score?: number | null;
  status?: number;
}

export interface ChapterAnswerListResult {
  ok: boolean;
  status: number;
  body: string;
  data?: {
    score?: number;
    userAnswersResult?: ChapterAnswerListChild[];
    correctAnswers?: Array<{
      childId?: string;
      answers?: Array<{ answerValue?: string }>;
    }>;
  };
}

/**
 * Read a group's stored answers.
 *
 * Besides the learner's values this returns the reference answer
 * (`correctAnswers`) and the per-child score, which is what the answer bank
 * uses as ground truth.
 */
export async function fetchChapterAnswerList(
  options: ChapterApiOptions,
  groupId: string,
  versionNumber: string,
  fetcher: typeof fetch = fetch,
): Promise<ChapterAnswerListResult> {
  const url =
    `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/answer/list` +
    `?questionId=${encodeURIComponent(groupId)}` +
    `&versionNumber=${encodeURIComponent(versionNumber)}`;
  const response = await fetcher(url, {
    method: "GET",
    headers: {
      authorization: authHeader(options.token),
      lovefrom: "learner",
      accept: "application/json",
    },
  });
  const body = await response.text();
  let data: ChapterAnswerListResult["data"];
  try {
    const json = JSON.parse(body) as { code?: number; data?: any };
    if (json.code === 200 && json.data) data = json.data;
  } catch {
    data = undefined;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    ...(data ? { data } : {}),
  };
}

/** `POST /api/reader/action/finishNode` — marks a chapter node as read/done. */
export async function finishChapterNode<T = unknown>(
  options: ChapterApiOptions,
  meta: ChapterSubmitMeta,
  node: ChapterNodeRef,
  fetcher: typeof fetch = fetch,
): Promise<ChapterApiResult<T>> {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  return postJson<T>(
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
      b,
    },
    fetcher,
  );
}
