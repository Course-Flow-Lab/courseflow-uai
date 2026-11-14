/**
 * Host question-bank adapter.
 *
 * Only objective questions are cached: choice, judge and fill-in-the-blank.
 * Matching and free-text questions are deliberately skipped because their
 * platform encoding is not stable enough to fingerprint or replay.
 *
 * The pure mapping helpers stay free of I/O so they can be unit-tested
 * offline. The RPC helpers below are wired to the module's JSON-RPC channel by
 * `configureBank` and swallow every error: a bank miss must never fail a step.
 */

export type BankKind = 'single' | 'multiple' | 'judge' | 'blank';

export interface BankOption {
  id: string;
  text: string;
}

export interface BankQuestion {
  kind: BankKind;
  text: string;
  options: BankOption[];
  blanks?: number;
  context?: string;
}

export interface BankHit {
  questionId: string;
  texts: string[];
  confidence: number;
  source: 'bank';
}

/** One lookup result before it is shaped for the chapter or paper contract. */
export interface BankAnswerHit {
  questionId: string;
  answer: string[];
  texts: string[];
}

type HostCall = (method: string, params: Record<string, unknown>) => Promise<any>;
type LogFn = (level: string, message: string) => void;

let hostCall: HostCall | null = null;
let hostLog: LogFn = () => {};

/** Wire the bank adapter to the module's host RPC channel. */
export function configureBank(call: HostCall, log: LogFn): void {
  hostCall = call;
  hostLog = log;
}

/** Shared course scope for chapters and papers, so both can reuse answers. */
export function courseScope(cfg: any): string {
  return `${String(cfg?.bookId ?? '')}/${String(cfg?.bookVersion ?? '')}`;
}

const clean = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();

const KIND_BY_TYPE: Record<string, BankKind> = {
  single_choice: 'single',
  single: 'single',
  multiple_choice: 'multiple',
  multiple: 'multiple',
  true_false: 'judge',
  judge: 'judge',
  fill_blanks: 'blank',
  fill_blanks_choice: 'blank',
};

function rawTypeOf(question: any): string {
  const raw = String(question?.rawType ?? question?.type ?? '')
    .trim()
    .toLowerCase();
  return raw.endsWith('_group') ? raw.slice(0, -'_group'.length) : raw;
}

function bankKindOf(question: any): BankKind | null {
  return KIND_BY_TYPE[rawTypeOf(question)] ?? null;
}

function optionSource(question: any): any[] {
  return Array.isArray(question?.options) ? question.options : [];
}

/** Option id as used by the bank: `id`, then the platform `optionId`/`value`. */
function optionIdOf(option: any, index = 0): string {
  return (
    String(option?.id ?? option?.optionId ?? option?.value ?? index) || String(index)
  );
}

function blankCountOf(question: any): number {
  const raw =
    Number(question?.blankCount) ||
    (Array.isArray(question?.childIds) ? question.childIds.length : 0) ||
    1;
  return Math.min(200, Math.max(1, Math.trunc(raw)));
}

/**
 * Map one U校园 question to the host bank shape.
 *
 * `context` only carries the reading passage. Section instructions and image
 * URLs are volatile (signed URLs, A/B wording), so they must stay out of the
 * fingerprint. Duplicate option text cannot be canonicalised by the bank, so
 * such questions are not cached at all.
 */
export function toBankQuestion(question: any): BankQuestion | null {
  const kind = bankKindOf(question);
  if (!kind) return null;

  const text = String(question?.stem ?? '').trim();
  if (!text) return null;

  const options: BankOption[] = [];
  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();
  for (const [index, option] of optionSource(question).entries()) {
    const optionText = String(option?.text ?? '').trim();
    if (!optionText) return null;
    const textKey = clean(optionText);
    if (seenTexts.has(textKey)) return null;
    seenTexts.add(textKey);

    const base = optionIdOf(option, index);
    let id = base;
    let suffix = 1;
    while (seenIds.has(id)) {
      id = `${base}#${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);
    options.push({ id, text: optionText });
  }

  if ((kind === 'single' || kind === 'multiple' || kind === 'judge') && options.length === 0) {
    return null;
  }

  const passage = String(question?.passage ?? '').trim();
  return {
    kind,
    text,
    options,
    ...(kind === 'blank' ? { blanks: blankCountOf(question) } : {}),
    ...(passage ? { context: passage } : {}),
  };
}

const TRUE_WORDS = new Set(['true', 't', 'yes', 'y', '正确', '对', '是', '√']);
const FALSE_WORDS = new Set(['false', 'f', 'no', 'n', '错误', '错', '否', '×', 'x']);

/** Semantic truth of an option label/text; `A`/`B` stay undecidable. */
function truthOf(value: unknown): 'true' | 'false' | null {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  if (TRUE_WORDS.has(text)) return 'true';
  if (FALSE_WORDS.has(text)) return 'false';
  return null;
}

function optionTruth(option: any): 'true' | 'false' | null {
  return truthOf(option?.text) ?? truthOf(option?.label);
}

/** Flatten an answer value that may be a scalar, a JSON array or nested. */
function rawValues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((value) => rawValues(value));
  if (raw == null) return [];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.flatMap((value) => rawValues(value));
      } catch {
        // not JSON; keep the raw text
      }
    }
    return trimmed ? [trimmed] : [];
  }
  return [String(raw)];
}

/** Resolve one token to an option id by id, label or text. */
function matchOptionId(question: any, token: string): string | null {
  const value = clean(token);
  if (!value) return null;
  const lower = value.toLowerCase();
  const options = optionSource(question);
  const raw = String(token).trim();
  const byIdIndex = options.findIndex((option, index) => optionIdOf(option, index) === raw);
  if (byIdIndex >= 0) return optionIdOf(options[byIdIndex], byIdIndex);
  const byLabelIndex = options.findIndex(
    (option) => clean(option?.label).toLowerCase() === lower,
  );
  if (byLabelIndex >= 0) return optionIdOf(options[byLabelIndex], byLabelIndex);
  const byTextIndex = options.findIndex((option) => clean(option?.text) === value);
  if (byTextIndex >= 0) return optionIdOf(options[byTextIndex], byTextIndex);
  return null;
}

/** Platform option id list -> bank answer ids. */
function choiceAnswer(question: any, kind: 'single' | 'multiple', raw: unknown): string[] | null {
  const tokens = rawValues(raw).map((value) => value.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  const ids: string[] = [];
  for (const token of tokens) {
    const direct = matchOptionId(question, token);
    if (direct) {
      ids.push(direct);
      continue;
    }
    // Packed forms: "A,B", "A/B" or concatenated labels "AB".
    const parts = token.split(/[\s,，、;；/|]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      const mapped = parts.map((part) => matchOptionId(question, part));
      if (mapped.every((id): id is string => Boolean(id))) {
        ids.push(...mapped);
        continue;
      }
    }
    const chars = [...token];
    if (chars.length > 1) {
      const mapped = chars.map((char) => matchOptionId(question, char));
      if (mapped.every((id): id is string => Boolean(id))) {
        ids.push(...mapped);
        continue;
      }
    }
    return null;
  }

  const unique = [...new Set(ids)];
  if (kind === 'single') return unique.length === 1 ? unique : null;
  return unique.length > 0 ? unique : null;
}

/** Platform value -> `true` / `false`, refusing ambiguous labels like A/B. */
function judgeAnswer(question: any, raw: unknown): 'true' | 'false' | null {
  const tokens = rawValues(raw).map((value) => value.trim()).filter(Boolean);
  if (tokens.length !== 1) return null;

  const token = tokens[0]!;
  const direct = truthOf(token);
  if (direct) return direct;

  const options = optionSource(question);
  const byId = options.find(
    (option, index) => optionIdOf(option, index) === String(token).trim(),
  );
  if (byId) return optionTruth(byId);

  const lower = token.toLowerCase();
  for (const option of options) {
    if (clean(option?.label).toLowerCase() === lower || clean(option?.text).toLowerCase() === lower) {
      return optionTruth(option);
    }
  }
  return null;
}

/** Platform blank values -> one text per blank, in child order. */
function blankAnswer(question: any, raw: unknown): string[] | null {
  const expected = blankCountOf(question);
  let values = rawValues(raw).map((value) => String(value).trim());
  if (values.length === 1 && expected > 1) {
    values = values[0]!.split(/\r?\n/).map((value) => value.trim());
  }
  if (values.length !== expected || values.some((value) => !value)) return null;
  return values;
}

/**
 * Convert a platform answer value (option id, label, option text, JSON array or
 * blank list) into the host bank answer format.
 */
export function platformKeyToBankAnswer(question: any, raw: unknown): string[] | null {
  const kind = bankKindOf(question);
  if (!kind) return null;
  if (kind === 'single' || kind === 'multiple') return choiceAnswer(question, kind, raw);
  if (kind === 'judge') {
    const truth = judgeAnswer(question, raw);
    return truth ? [truth] : null;
  }
  return blankAnswer(question, raw);
}

/** Submitted answer texts -> host bank answer (ids for choices). */
export function textsToBankAnswer(question: any, texts: string[]): string[] | null {
  const kind = bankKindOf(question);
  if (!kind || !Array.isArray(texts)) return null;
  if (kind === 'single' || kind === 'multiple') return choiceAnswer(question, kind, texts);
  if (kind === 'judge') {
    const truth = judgeAnswer(question, texts);
    return truth ? [truth] : null;
  }
  return blankAnswer(question, texts);
}

/** Host bank answer -> the texts the reader submit payload expects. */
export function bankAnswerToTexts(question: any, answer: string[]): string[] | null {
  const kind = bankKindOf(question);
  if (!kind || !Array.isArray(answer) || answer.length === 0) return null;

  if (kind === 'single' || kind === 'multiple') {
    const options = optionSource(question);
    const texts: string[] = [];
    for (const id of answer) {
      const option = options.find(
        (item, index) => optionIdOf(item, index) === String(id),
      );
      const text = String(option?.text ?? '');
      if (!text.trim()) return null;
      texts.push(text);
    }
    return texts;
  }

  if (kind === 'judge') {
    if (answer.length !== 1) return null;
    const truth = truthOf(answer[0]);
    if (!truth) return null;
    const option = optionSource(question).find((item) => optionTruth(item) === truth);
    const text = String(option?.text ?? '');
    return text.trim() ? [text] : null;
  }

  const expected = blankCountOf(question);
  const texts = answer.map((value) => String(value).trim());
  return texts.length === expected && texts.every(Boolean) ? texts : null;
}

/** Compare bank answers; multiple-choice order does not matter. */
export function answersEqual(question: any, left: string[], right: string[]): boolean {
  const kind = bankKindOf(question);
  const normalize = (values: string[]): string[] =>
    kind === 'multiple' ? [...values].sort() : [...values];
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

async function callBank(method: string, params: Record<string, unknown>): Promise<any> {
  if (!hostCall) throw new Error('question bank host is not configured');
  return hostCall(method, params);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as any).message === 'string') {
    return String((error as any).message);
  }
  return String(error);
}

async function lookupEntries(
  session: string,
  course: string,
  questions: any[],
): Promise<BankAnswerHit[]> {
  const hits: BankAnswerHit[] = [];
  for (const question of questions ?? []) {
    const bankQuestion = toBankQuestion(question);
    if (!bankQuestion) continue;
    const questionId = String(question?.id ?? '');
    try {
      const result = await callBank('cw.question_bank.lookup', {
        session,
        course,
        question: bankQuestion,
      });
      const correct = (result as any)?.correct;
      if (!Array.isArray(correct) || correct.length === 0) continue;
      const texts = bankAnswerToTexts(question, correct);
      if (!texts) {
        hostLog('warn', `question bank answer for ${questionId} did not map to option text`);
        continue;
      }
      hits.push({ questionId, answer: correct.map(String), texts });
    } catch (error) {
      hostLog('warn', `question bank lookup ${questionId} failed: ${messageOf(error)}`);
    }
  }
  return hits;
}

/**
 * Look up every cacheable question. A hit carries the option texts the reader
 * submit path expects, so callers can use it as a drop-in LLM replacement.
 */
export async function lookupAnswers(
  session: string,
  course: string,
  questions: any[],
): Promise<BankHit[]> {
  const entries = await lookupEntries(session, course, questions);
  return entries.map(({ questionId, texts }) => ({
    questionId,
    texts,
    confidence: 1,
    source: 'bank',
  }));
}

/**
 * Same lookup, but also keeps the bank answer itself (option ids for choice,
 * `true`/`false` for judge, texts for blanks). The framework validates paper
 * answers against that shape.
 */
export async function lookupBankAnswers(
  session: string,
  course: string,
  questions: any[],
): Promise<BankAnswerHit[]> {
  return lookupEntries(session, course, questions);
}

async function submitBankAnswer(
  method: string,
  session: string,
  course: string,
  question: any,
  answer: string[],
  extra: Record<string, unknown>,
): Promise<void> {
  const bankQuestion = toBankQuestion(question);
  if (!bankQuestion) return;
  try {
    await callBank(method, {
      session,
      course,
      question: bankQuestion,
      answer,
      ...extra,
    });
  } catch (error) {
    hostLog(
      'warn',
      `question bank ${method.split('.').pop()} ${String(question?.id ?? '')} failed: ${messageOf(error)}`,
    );
  }
}

/** Persist a platform-confirmed answer. */
export function confirmCorrect(
  session: string,
  course: string,
  question: any,
  answer: string[],
  reference: string,
): Promise<void> {
  return submitBankAnswer('cw.question_bank.confirm', session, course, question, answer, {
    confirmation: { confirmed: true, source: 'platform', reference: String(reference ?? '') },
  });
}

/** Persist a wrong submission so the same mistake is not replayed. */
export function recordIncorrect(
  session: string,
  course: string,
  question: any,
  answer: string[],
): Promise<void> {
  return submitBankAnswer('cw.question_bank.record', session, course, question, answer, {
    evidence: { result: 'incorrect', source: 'platform' },
  });
}
