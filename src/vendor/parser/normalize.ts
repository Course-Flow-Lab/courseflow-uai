/**
 * Normalization used for option matching and question fingerprints.
 * Full-width characters are folded to ASCII, punctuation and case are dropped
 * so that "A. London" and "london" compare equal.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?'"()[\]{}<>/\\|`~@#$%^&*+=_-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim a leading question number such as "1." / "1、" / "(1)". */
export function stripQuestionNumber(stem: string): string {
  return stem.replace(/^\s*(?:第?\s*\d+\s*[).、．:：]|\(\s*\d+\s*\))\s*/, "").trim();
}

/** A lone A/B/C/D answer is never accepted: options are shuffled per account. */
export function isBareOptionLetter(text: string): boolean {
  return /^[a-dA-D]$/.test(text.trim());
}
