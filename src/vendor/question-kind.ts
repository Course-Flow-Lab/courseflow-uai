import type { AnswerMode, QuestionType } from "./types.js";

/**
 * One authoritative place that maps a platform question type to:
 * - the coarse `QuestionType` the filler/solver understand,
 * - how the answer is captured (`AnswerMode`),
 * - whether the page actually renders an answer control,
 * - a short instruction for the LLM.
 *
 * Both the chapter reader (`ucampus-extract` / `chapter-structure`) and the
 * Unit Test paper parser use this table, so the two paths cannot drift apart.
 */
export interface QuestionKind {
  rawType: string;
  type: QuestionType;
  answerMode: AnswerMode;
  fillable: boolean;
  /** True when filling needs pointer drag rather than a click/text input. */
  requiresDrag: boolean;
  /** Extra prompt instruction. Empty for plain questions. */
  hint: string;
}

const KIND_TABLE: Record<
  string,
  Omit<QuestionKind, "rawType" | "requiresDrag"> & { requiresDrag?: boolean }
> = {
  single_choice: {
    type: "single",
    answerMode: "option",
    fillable: true,
    hint: "单选题：返回 1 个选项的完整原文。",
  },
  multiple_choice: {
    type: "multiple",
    answerMode: "option",
    fillable: true,
    hint: "多选题：返回所有正确选项的完整原文。",
  },
  true_false: {
    type: "judge",
    answerMode: "option",
    fillable: true,
    hint: "判断题：返回选项原文（如“正确”“错误”），不要返回 T/F。",
  },
  fill_blanks: {
    type: "fill",
    answerMode: "blanks",
    fillable: true,
    hint:
      "填空题：按 {{1}}…{{n}} 的顺序，每个空只返回缺失的词或短语，不要重复整句，不要带序号。",
  },
  fill_blanks_choice: {
    type: "fill",
    answerMode: "blanks",
    fillable: true,
    hint:
      "选词填空：只能从 options 词库中选词，每个词最多使用一次，按空顺序返回。",
  },
  translation: {
    type: "short",
    answerMode: "text",
    fillable: true,
    hint:
      "翻译/补全：若题干括号内有中文，只返回该中文对应的英文表达；若整句是中文，则返回完整英文译文。不要解释。",
  },
  short_answer: {
    type: "short",
    answerMode: "text",
    fillable: true,
    hint:
      "简答题：结合题干作答；若给了 passage，只用其中事实，不要复述原文。答案要简短、直接。",
  },
  writing: {
    type: "short",
    answerMode: "text",
    fillable: true,
    hint: "写作题：按题干字数与结构要求写完整短文，只输出正文。",
  },
  text_match: {
    type: "matching",
    answerMode: "pairs",
    fillable: true,
    requiresDrag: true,
    hint:
      "匹配题：按 pairs[].left 的顺序，返回每个左侧项对应的右侧选项原文。",
  },
  oral_personal_state: {
    type: "speaking",
    answerMode: "none",
    fillable: false,
    hint: "",
  },
  multi_media_upload: {
    type: "upload",
    answerMode: "none",
    fillable: false,
    hint: "",
  },
  discussion: {
    type: "discussion",
    answerMode: "none",
    fillable: false,
    hint: "",
  },
  rich_text_read: {
    type: "reading",
    answerMode: "none",
    fillable: false,
    hint: "",
  },
  rich_text_read_group: {
    type: "reading",
    answerMode: "none",
    fillable: false,
    hint: "",
  },
};

/** Raw types that carry no answer control at all. */
const NON_FILLABLE = new Set([
  "oral_personal_state",
  "multi_media_upload",
  "discussion",
  "rich_text_read",
  "rich_text_read_group",
]);

export function classifyQuestion(rawType: string | undefined): QuestionKind {
  const raw = (rawType ?? "").trim();
  const known = KIND_TABLE[raw];
  if (known) {
    return { rawType: raw, requiresDrag: false, ...known };
  }

  // Group-level types use a `_group` suffix; strip it and retry so a group
  // without explicit per-question types still classifies correctly.
  if (raw.endsWith("_group")) {
    const base = raw.slice(0, -"_group".length);
    const groupKnown = KIND_TABLE[base];
    if (groupKnown) {
      return { rawType: raw, requiresDrag: false, ...groupKnown };
    }
    if (NON_FILLABLE.has(base)) {
      return {
        rawType: raw,
        type: "unknown",
        answerMode: "none",
        fillable: false,
        requiresDrag: false,
        hint: "",
      };
    }
  }

  return {
    rawType: raw,
    type: "unknown",
    answerMode: "none",
    fillable: false,
    requiresDrag: false,
    hint: "",
  };
}

export function isFillable(rawType: string | undefined): boolean {
  return classifyQuestion(rawType).fillable;
}

/** Strip reader-only chrome that leaks into extracted stems/passages. */
export function stripReaderChrome(input: string): string {
  return input
    .replace(/\b(?:自动判题|计分|提交|预览|打开精读模式)\b/g, " ")
    .replace(/\d+\s*\/\s*10000/g, " ")
    .replace(/准备时长\s*\d{1,2}:\d{2}/g, " ")
    .replace(/作答时长\s*\d{1,2}:\d{2}/g, " ")
    .replace(/点击开始(?:录制|作答)?/g, " ")
    .replace(/\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
