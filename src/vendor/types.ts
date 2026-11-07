export type QuestionType =
  | "single"
  | "multiple"
  | "judge"
  | "fill"
  | "short"
  | "reading"
  | "matching"
  | "speaking"
  | "upload"
  | "discussion"
  | "unknown";

/** How a question's answer is captured on the page. */
export type AnswerMode = "option" | "text" | "blanks" | "pairs" | "none";

export interface QuestionOption {
  index: number;
  text: string;
  value?: string;
  imageUrl?: string;
  /** Platform option id (used by the paper save API and matching edges). */
  optionId?: string;
  /** Visible label, e.g. "A" for choices or the word for a word bank. */
  label?: string;
}

/** One answer slot, keyed by the platform's own blank id. */
export interface QuestionBlank {
  /** `children[].childId` in the chapter API / `data-dig-empty-id` in the DOM. */
  id?: string;
  /** 1-based display index, matching `{{n}}` in the stem. */
  index: number;
}

/** One left-hand item of a matching question. */
export interface QuestionPair {
  id?: string;
  left: string;
}

export interface Question {
  /** Stable within a page, derived from data attributes or position. */
  id: string;
  index: number;
  type: QuestionType;
  stem: string;
  passage?: string;
  /** Section-level task text that is not part of the stem. */
  instruction?: string;
  options: QuestionOption[];
  blankCount: number;
  /** Answer slots in display order. Empty for non-blank questions. */
  blanks?: QuestionBlank[];
  /** Every answer child id (`children[].childId`), in order. */
  childIds?: string[];
  /** Left items for matching questions. */
  pairs?: QuestionPair[];
  answerMode?: AnswerMode;
  /** Platform question group id, kept for grouping/telemetry. */
  groupId?: string;
  /** Platform question group version, required by `submitScore`. */
  groupVersion?: string;
  score?: number;
  /** Original data-type / class hint, kept for adapter debugging. */
  rawType?: string;
}

export interface Answer {
  questionId: string;
  /** Answer texts. For choice questions these must match option text, never letters. */
  texts: string[];
  confidence: number;
  source: "llm" | "cache" | "manual" | "bank";
  reason?: string;
}

export interface Chapter {
  title: string;
  href: string;
  locked: boolean;
}

export interface Course {
  title: string;
  href: string;
  chapters: Chapter[];
}

export interface ExtractResult {
  questions: Question[];
  warnings: string[];
}
