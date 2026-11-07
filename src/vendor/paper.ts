import { classifyQuestion } from "./question-kind.js";
import type { Question, QuestionOption } from "./types.js";

export interface PaperQuestion extends Question {
  groupId: string;
  childId?: string;
  /** Every answer child (blank) in order; multi-blank groups need all of them. */
  childIds?: string[];
  /** Option IDs in DOM/option order, used by the paper save API later. */
  optionIds?: string[];
  rawType: string;
}

export interface PaperData {
  instanceId?: string;
  paperId: string;
  paperName: string;
  paperType: number;
  versionNumber: string;
  questionCount: number;
  totalScore: number;
  questions: PaperQuestion[];
}

export function lexicalText(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return lexicalText(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => lexicalText(item)).join("");
  }
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.children)) {
      return node.children.map((item) => lexicalText(item)).join("");
    }
    // Lexical documents wrap the content in a `root` object.
    if (node.root) return lexicalText(node.root);
  }
  return "";
}

/**
 * The Unit Test paper and the chapter reader share one classification table so
 * a `multi_media_upload` never becomes a fillable short answer on one path and
 * an unsupported type on the other.
 */
function mapType(raw: string | undefined): PaperQuestion["type"] {
  return classifyQuestion(raw).type;
}

/**
 * Parse the `data` returned by
 * `/api/reader/paper/instance/createPaperInstanceByPublishedBook`.
 *
 * The paper model nests answer targets under `children` (childId), while the
 * top-level question carries the stem/score. We flatten each top-level question
 * into one `PaperQuestion`, keeping `groupId`/`childId` for the save API.
 */
export function parsePaperData(input: unknown): PaperData {
  const data = (input ?? {}) as Record<string, any>;
  const groups = (data.bigQuestionGroupDTOs ?? []) as Array<Record<string, any>>;
  const questions: PaperQuestion[] = [];
  const usedIds = new Set<string>();

  for (const group of groups) {
    const groupId = String(group.groupId ?? "");
    const material = group.material ? lexicalText(group.material) : undefined;
    const list = (group.list ?? []) as Array<Record<string, any>>;

    for (const raw of list) {
      const rawType = String(raw.questionType ?? group.groupType ?? "");
      const kind = classifyQuestion(rawType);
      const type = kind.type;
      const children = (raw.children ?? []) as Array<Record<string, any>>;
      const child = children[0] ?? raw;
      const stem = String(
        raw.quesTextString ?? lexicalText(raw.quesText) ?? "",
      ).trim();
      if (!stem) continue;

      const options: QuestionOption[] = (
        (child.options ?? []).length > 0 ? child.options : raw.options ?? []
      ).map((option: Record<string, any>, index: number) => ({
        index,
        text:
          rawType === "fill_blanks_choice" && option.label
            ? String(option.label).trim()
            : lexicalText(option.optionValue) || String(option.label ?? "").trim(),
        ...(option.optionId ? { value: String(option.optionId) } : {}),
        ...(option.label ? { label: String(option.label) } : {}),
        ...(option.optionId ? { optionId: String(option.optionId) } : {}),
      }));

      const childIds = children
        .map((item) => (item.childId ? String(item.childId) : ""))
        .filter(Boolean);

      const baseId = String(raw.id ?? child.childId ?? `q${questions.length + 1}`);
      const id = usedIds.has(baseId)
        ? `${groupId}:${baseId}`
        : baseId;
      usedIds.add(id);

      const question: PaperQuestion = {
        id,
        index: questions.length,
        type,
        stem,
        options,
        blankCount:
          kind.answerMode === "blanks" || kind.answerMode === "text"
            ? Math.max(children.length, 1)
            : 0,
        answerMode: kind.answerMode,
        groupId,
        rawType,
        ...(children.length > 0
          ? {
              blanks: children.map((item, position) => ({
                ...(item.childId ? { id: String(item.childId) } : {}),
                index: position + 1,
              })),
            }
          : {}),
        ...(child.childId ? { childId: String(child.childId) } : {}),
        ...(childIds.length > 0 ? { childIds } : {}),
        ...(options.some((option) => option.value)
          ? {
              optionIds: options.map((option) => String(option.value ?? "")),
            }
          : {}),
      };
      if (material) question.passage = material;
      if (typeof raw.score === "number") question.score = raw.score;

      questions.push(question);
    }
  }

  return {
    instanceId: data.instanceId ? String(data.instanceId) : undefined,
    paperId: String(data.paperId ?? ""),
    paperName: String(data.paperName ?? ""),
    paperType: Number(data.paperType ?? 0),
    versionNumber: String(data.versionNumber ?? ""),
    questionCount: Number(data.questionCount ?? questions.length),
    totalScore: Number(data.totalScore ?? 0),
    questions,
  };
}
