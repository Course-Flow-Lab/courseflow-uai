import type { QuestionOption } from "./types.js";
import { isBareOptionLetter, normalizeText } from "./parser/normalize.js";

const TRUE_WORDS = new Set(["对", "正确", "是", "true", "t", "yes", "y"]);
const FALSE_WORDS = new Set(["错", "错误", "否", "false", "f", "no", "n"]);

function judgeValue(text: string): "true" | "false" | null {
  const value = text.trim().toLowerCase();
  if (TRUE_WORDS.has(value)) return "true";
  if (FALSE_WORDS.has(value)) return "false";
  return null;
}

function tokens(text: string): Set<string> {
  const normalized = normalizeText(text);
  if (!normalized) return new Set();
  if (normalized.includes(" ")) {
    return new Set(normalized.split(" ").filter(Boolean));
  }
  // CJK has no spaces: use character bigrams.
  const chars = [...normalized];
  const grams = new Set<string>(chars);
  for (let i = 0; i < chars.length - 1; i += 1) {
    grams.add(chars[i]! + chars[i + 1]!);
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export function similarity(left: string, right: string): number {
  const leftJudge = judgeValue(left);
  const rightJudge = judgeValue(right);
  if (leftJudge && rightJudge) return leftJudge === rightJudge ? 1 : 0;

  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.82 + ratio * 0.12;
  }
  return jaccard(tokens(a), tokens(b));
}

export interface OptionMatch {
  option: QuestionOption;
  score: number;
}

/**
 * Match an answer text to an option. Bare A/B/C/D answers are rejected on
 * purpose: U校园 shuffles options per account, so letters are meaningless.
 */
export function matchOption(
  answerText: string,
  options: QuestionOption[],
  threshold = 0.6,
): OptionMatch | null {
  if (isBareOptionLetter(answerText)) return null;

  let best: OptionMatch | null = null;
  for (const option of options) {
    if (!option.text) continue;
    const score = similarity(answerText, option.text);
    if (!best || score > best.score) best = { option, score };
  }

  if (!best || best.score < threshold) return null;
  return best;
}

export function matchOptions(
  answerTexts: string[],
  options: QuestionOption[],
  threshold = 0.6,
): OptionMatch[] {
  const matches: OptionMatch[] = [];
  const used = new Set<number>();
  for (const text of answerTexts) {
    const match = matchOption(text, options, threshold);
    if (!match || used.has(match.option.index)) continue;
    used.add(match.option.index);
    matches.push(match);
  }
  return matches;
}
