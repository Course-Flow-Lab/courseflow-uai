import { classifyQuestion, stripReaderChrome } from "./question-kind.js";
import { lexicalText } from "./paper.js";
import type {
  Question,
  QuestionBlank,
  QuestionOption,
  QuestionPair,
} from "./types.js";

/**
 * Structure-first chapter segmentation.
 *
 * The reader already ships a linear outline (`studentContent.json`) where every
 * node carries an `anchor` that is rendered as the DOM `id`, plus a
 * `questionList` that describes every scored question group. Using that outline
 * avoids the old heuristics (heading text + occurrence + previous-sibling text)
 * that attached the wrong passage to the wrong question.
 */

export interface ChapterStructureNode {
  index: number;
  type: string;
  anchor?: string;
  headingLevel?: number;
  /** Lexical heading tag (`h1`…`h6`), used as `finishNode.nodeType`. */
  tag?: string;
  text: string;
  questionGroupId?: string;
  questionType?: string;
}

export interface ChapterStructureGroup {
  groupId: string;
  groupType: string;
  versionNumber?: string;
  questionCount: number;
  questionTypes: string[];
}

export interface ChapterStructureActivity {
  anchor: string;
  title: string;
  level: number;
  /** Level of the enclosing heading, used for passage inheritance. */
  parentLevel?: number;
  startIndex: number;
  endIndex: number;
  questionGroups: ChapterStructureGroup[];
  questions: Question[];
  instruction?: string;
  passage?: string;
  passageAnchor?: string;
  /**
   * `true` when the activity was synthesised for a `questionList` group that has
   * no rendered question-block in the chapter content. The platform still scores
   * these groups, so they must stay reachable instead of being dropped.
   */
  unmapped?: boolean;
}

export interface ChapterStructure {
  activities: ChapterStructureActivity[];
  nodes: ChapterStructureNode[];
  warnings: string[];
}

/** One node handed to `POST /api/reader/action/finishNode`. */
export interface FinishPlanNode {
  nodeId: string;
  nodeType: string;
}

/**
 * Node types the platform does not register as finishable.
 *
 * `highlight-block` exists in the Lexical content with an anchor but
 * `finishNode` answers `500 节点不存在` for it, so it is not a completion unit.
 */
const NON_FINISHABLE_NODE_TYPES = new Set(["highlight-block"]);

/**
 * Every top-level node inside an activity range, in reading order.
 *
 * This mirrors what the reader posts while the learner scrolls: headings carry
 * their Lexical tag (`h1`…`h6`), everything else carries its block type.
 */
export function buildFinishPlan(
  structure: ChapterStructure,
  activity: ChapterStructureActivity,
): FinishPlanNode[] {
  return structure.nodes
    .filter(
      (node) =>
        node.index >= activity.startIndex &&
        node.index < activity.endIndex &&
        node.anchor &&
        !NON_FINISHABLE_NODE_TYPES.has(node.type),
    )
    .map((node) => ({
      nodeId: node.anchor!,
      nodeType: node.type === "heading" ? (node.tag ?? "h1") : node.type,
    }));
}

export interface ChapterRawData {
  questionList?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse JSON stored inside a string field; return the value otherwise. */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith('"') && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function anchorOf(node: Record<string, any>): string | undefined {
  const raw = node.$?.__anchor__ ?? node.id;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function headingLevelOf(node: Record<string, any>): number | undefined {
  if (node.type !== "heading") return undefined;
  const match = typeof node.tag === "string" ? node.tag.match(/^h([1-6])$/i) : null;
  return match ? Number(match[1]) : 2;
}

function cleanInline(text: string): string {
  return text.replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

interface LexicalSplit {
  text: string;
  blanks: QuestionBlank[];
}

/**
 * Flatten a Lexical document to text and turn every `insert-dig-empty` node
 * into a `{{n}}` placeholder. The placeholder order is the DOM blank order and
 * the id is the platform blank id (`children[].childId` / `data-dig-empty-id`).
 */
export function lexicalToStem(value: unknown): LexicalSplit {
  const blanks: QuestionBlank[] = [];
  const parts: string[] = [];
  const parsed = parseMaybeJson(value);

  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;

    switch (node.type) {
      case "text":
        parts.push(String(node.text ?? ""));
        return;
      case "linebreak":
        parts.push("\n");
        return;
      case "insert-dig-empty": {
        const index = blanks.length + 1;
        blanks.push({
          ...(node.id ? { id: String(node.id) } : {}),
          index,
        });
        parts.push(`{{${index}}}`);
        return;
      }
      case "insert-image":
        parts.push(" [图片] ");
        return;
      case "insert-video":
        parts.push(" [视频] ");
        return;
      case "insert-audio":
        parts.push(" [音频] ");
        return;
      default:
        if (node.root) walk(node.root);
        else if (Array.isArray(node.children)) node.children.forEach(walk);
    }
  };

  walk(parsed);
  return { text: cleanInline(parts.join("")), blanks };
}

function optionText(option: Record<string, any>): string {
  const fromValue = lexicalText(option.optionValue);
  if (fromValue.trim()) return fromValue.trim();
  return String(option.label ?? "").trim();
}

function buildOptions(
  raw: Record<string, any>,
  child: Record<string, any> | undefined,
  groupType: string,
  rawType: string,
): QuestionOption[] {
  const source = Array.isArray(child?.options) && child!.options.length > 0
    ? child!.options
    : Array.isArray(raw.options)
      ? raw.options
      : [];
  return source
    .map((option: Record<string, any>, index: number) => {
      const label = String(option.label ?? "").trim();
      // Word banks use the word itself as the label; choices use A/B/C/D and
      // keep the real text inside the Lexical option value.
      const text =
        rawType === "fill_blanks_choice" && label
          ? label
          : optionText(option) || label;
      const mapped: QuestionOption = { index, text };
      if (label) mapped.label = label;
      if (option.optionId) mapped.value = String(option.optionId);
      if (option.optionId) mapped.optionId = String(option.optionId);
      return mapped;
    })
    .filter((option: QuestionOption) => option.text.length > 0);
}

function buildPairs(children: Array<Record<string, any>>): QuestionPair[] {
  return children
    .map((child) => ({
      ...(child.childId ? { id: String(child.childId) } : {}),
      left: lexicalText(child.quesText).trim() || String(child.quesTextString ?? "").trim(),
    }))
    .filter((pair) => pair.left.length > 0);
}

/** One question from the platform `questionType` payload. */
export function buildStructureQuestion(
  raw: Record<string, any>,
  groupId: string,
  groupType: string,
  index = 0,
  groupVersion?: string,
): Question | null {
  if (!isObject(raw)) return null;
  const children = Array.isArray(raw.children) ? raw.children : [];
  const child = children[0];
  const rawType = String(raw.questionType ?? groupType ?? "");
  const kind = classifyQuestion(rawType);

  const { text: lexicalStem, blanks: lexicalBlanks } = lexicalToStem(raw.quesText);
  const pairs =
    kind.answerMode === "pairs" ? buildPairs(children) : ([] as QuestionPair[]);

  // Some types (notably `true_false`) leave the top-level stem empty and put it
  // on the first answer child instead.
  const childStem = children
    .map((item) => {
      const text = lexicalToStem(item.quesText).text;
      return text || String(item.quesTextString ?? "");
    })
    .find((text) => text.trim().length > 0);

  let stem = stripReaderChrome(
    lexicalStem || String(raw.quesTextString ?? "") || childStem || "",
  );
  if (!stem && pairs.length > 0) {
    // Matching groups carry their left items in `children`; there is no stem.
    stem = `Match each item with the correct option: ${pairs
      .map((pair) => pair.left)
      .join(" / ")}`;
  }
  if (!stem) return null;

  const blanks: QuestionBlank[] =
    lexicalBlanks.length > 0
      ? lexicalBlanks
      : children
          .map((item, position) => ({
            ...(item.childId ? { id: String(item.childId) } : {}),
            index: position + 1,
          }));

  const childIds = children
    .map((item) => (item.childId ? String(item.childId) : ""))
    .filter(Boolean);

  const options =
    kind.answerMode === "option" ||
    kind.answerMode === "pairs" ||
    rawType === "fill_blanks_choice"
      ? buildOptions(raw, child, groupType, rawType)
      : [];

  const question: Question = {
    id: String(raw.id ?? child?.childId ?? `${groupId}:${index}`),
    index,
    type: kind.type,
    stem,
    options,
    blankCount:
      kind.answerMode === "blanks" || kind.answerMode === "text"
        ? Math.max(blanks.length, 1)
        : 0,
    answerMode: kind.answerMode,
    rawType,
    groupId,
    ...(groupVersion ? { groupVersion } : {}),
    ...(childIds.length > 0 ? { childIds } : {}),
  };

  if (
    blanks.length > 0 &&
    (kind.answerMode === "blanks" || kind.answerMode === "text")
  ) {
    question.blanks = blanks;
  }
  if (pairs.length > 0) question.pairs = pairs;
  if (typeof raw.score === "number") question.score = raw.score;

  return question;
}

function normalizeGroup(raw: unknown): Record<string, any> | null {
  const value = parseMaybeJson(raw);
  if (!isObject(value)) return null;
  if (!Array.isArray(value.list)) return null;
  return value;
}

function groupKey(group: Record<string, any>): string {
  return String(group.groupId ?? "");
}

/**
 * Reading groups are not part of `questionList`; their body lives in
 * `questionData.list[].children[].quesText` (one Lexical doc per paragraph).
 */
function readingMaterial(group: Record<string, any>): string {
  const list = Array.isArray(group.list) ? group.list : [];
  const paragraphs: string[] = [];
  for (const item of list) {
    const children = Array.isArray(item.children) ? item.children : [];
    for (const child of children) {
      const text = lexicalText(child.quesText).trim();
      if (text) paragraphs.push(text);
    }
    if (paragraphs.length === 0) {
      const text = String(item.quesTextString ?? "").trim();
      if (text && !/^https?:/.test(text)) paragraphs.push(text);
    }
  }
  return cleanInline(paragraphs.join("\n"));
}

const GENERIC_STEMS = /^(?:provide your answer here\.?|请在此处作答\.?)$/i;

/**
 * Question kinds that commonly reference the section's reading passage.
 * Essays, translations, speaking and uploads do not, so attaching a 5k-char
 * article to them only burns tokens and invites hallucination.
 */
const PASSAGE_KINDS = new Set([
  "fill_blanks",
  "fill_blanks_choice",
  "single_choice",
  "multiple_choice",
  "true_false",
  "text_match",
]);

export function parseChapterStructure(input: ChapterRawData): ChapterStructure {
  const warnings: string[] = [];
  const groups = new Map<string, Record<string, any>>();
  const consumed = new Set<string>();

  for (const raw of Array.isArray(input.questionList) ? input.questionList : []) {
    const group = normalizeGroup(raw);
    if (group && groupKey(group)) groups.set(groupKey(group), group);
  }

  const content = parseMaybeJson(input.content);
  const root = isObject(content) && isObject(content.root) ? content.root : content;
  const children: Array<Record<string, any>> = isObject(root) && Array.isArray(root.children)
    ? root.children
    : [];

  if (children.length === 0) {
    warnings.push("chapter content has no renderable nodes");
    return { activities: [], nodes: [], warnings };
  }

  const nodes: ChapterStructureNode[] = children.map((node, index) => {
    const headingLevel = headingLevelOf(node);
    const text =
      node.type === "question-block"
        ? ""
        : cleanInline(lexicalText(node));
    return {
      index,
      type: String(node.type ?? "unknown"),
      ...(anchorOf(node) ? { anchor: anchorOf(node)! } : {}),
      ...(headingLevel ? { headingLevel } : {}),
      ...(typeof node.tag === "string" ? { tag: node.tag } : {}),
      text,
      ...(node.questionType ? { questionType: String(node.questionType) } : {}),
      ...(node.questionGroup ? { questionGroupId: String(node.questionGroup) } : {}),
    };
  });

  const activities: ChapterStructureActivity[] = [];
  // A reading passage belongs to the enclosing section, not to the heading that
  // happens to contain the reading block: "Reading in detail" (h3) is nested in
  // "Reading 1" (h2), and its passage must reach the h4 comprehension questions.
  const passageStack: Array<{
    ownerLevel: number;
    text: string;
    anchor: string;
  }> = [];
  const headingStack: number[] = [];
  let current: ChapterStructureActivity | null = null;
  let instructionParts: string[] = [];

  const activePassage = (): { text: string; anchor: string } | undefined => {
    const entry = passageStack[passageStack.length - 1];
    return entry ? { text: entry.text, anchor: entry.anchor } : undefined;
  };

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]!;
    const info = nodes[index]!;

    if (node.type === "heading") {
      if (current) current.endIndex = index;
      const level = info.headingLevel ?? 2;
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1]! >= level
      ) {
        headingStack.pop();
      }
      const parentLevel = headingStack[headingStack.length - 1];
      headingStack.push(level);
      while (
        passageStack.length > 0 &&
        passageStack[passageStack.length - 1]!.ownerLevel >= level
      ) {
        passageStack.pop();
      }
      current = {
        anchor: info.anchor ?? `heading-${index}`,
        title: info.text,
        level,
        ...(parentLevel !== undefined ? { parentLevel } : {}),
        startIndex: index,
        endIndex: children.length,
        questionGroups: [],
        questions: [],
      };
      instructionParts = [];
      activities.push(current);
      continue;
    }

    if (!current) continue;

    if (node.type === "question-block") {
      const group = normalizeGroup(node.questionData) ?? groups.get(info.questionGroupId ?? "") ?? null;
      const groupId = info.questionGroupId ?? (group ? groupKey(group) : "");
      const groupType = String(group?.groupType ?? node.questionType ?? info.questionType ?? "");
      // A block claims its group even when the payload is incomplete; otherwise
      // the group would be re-added later as an "unmapped" synthetic activity.
      if (info.questionGroupId) consumed.add(info.questionGroupId);
      if (group) consumed.add(groupKey(group));

      if (!group && !info.questionType) {
        warnings.push(`block #${index}: unresolved question group`);
        continue;
      }

      if (groupType === "rich_text_read_group" || groupType === "rich_text_read") {
        const text = group ? readingMaterial(group) : "";
        if (text.length > 200) {
          passageStack.push({
            ownerLevel: current.parentLevel ?? current.level,
            text: text.slice(0, 12_000),
            anchor: current.anchor,
          });
        } else {
          warnings.push(`block #${index}: reading material too short to use as passage`);
        }
        continue;
      }

      const list = Array.isArray(group?.list) ? group!.list : [];
      const questions: Question[] = [];
      const groupVersion = group?.versionNumber
        ? String(group.versionNumber)
        : undefined;
      for (const raw of list) {
        const question = buildStructureQuestion(
          raw,
          groupId,
          groupType,
          current.questions.length,
          groupVersion,
        );
        if (question) questions.push(question);
      }

      if (questions.length === 0) continue;

      const passage = activePassage();
      if (passage) {
        let applied = false;
        for (const question of questions) {
          if (PASSAGE_KINDS.has(question.rawType ?? "")) {
            question.passage = passage.text;
            applied = true;
          }
        }
        if (applied) {
          current.passage = passage.text;
          current.passageAnchor = passage.anchor;
        }
      }

      const instruction = stripReaderChrome(instructionParts.join(" ").trim());
      if (instruction) {
        for (const question of questions) {
          if (GENERIC_STEMS.test(question.stem)) {
            // "Provide your answer here." is a placeholder, not the task.
            question.stem = instruction;
            continue;
          }
          if (!question.instruction) question.instruction = instruction;
        }
        if (!current.instruction) current.instruction = instruction;
      }

      current.questions.push(...questions);
      const questionTypes = [...new Set(questions.map((question) => question.rawType ?? question.type))];
      current.questionGroups.push({
        groupId,
        groupType,
        ...(groupVersion ? { versionNumber: groupVersion } : {}),
        questionCount: questions.length,
        questionTypes,
      });
      instructionParts = [];
      continue;
    }

    if (info.text) instructionParts.push(info.text);
  }

  if (current) current.endIndex = children.length;

  // `questionList` can contain groups that have no rendered question-block in
  // `content` (observed in Unit 1 Reading 2 "Detailed understanding"). The
  // platform still scores them, so expose each as a synthetic activity instead
  // of silently dropping it.
  for (const [groupId, group] of groups) {
    if (consumed.has(groupId)) continue;
    const list = Array.isArray(group.list) ? group.list : [];
    const groupType = String(group.groupType ?? "");
    const groupVersion = group.versionNumber ? String(group.versionNumber) : undefined;
    const questions: Question[] = [];
    for (const raw of list) {
      const question = buildStructureQuestion(
        raw,
        groupId,
        groupType,
        questions.length,
        groupVersion,
      );
      if (question) questions.push(question);
    }
    if (questions.length === 0) {
      warnings.push(`unmapped question group ${groupId}: no parseable questions`);
      continue;
    }

    const instruction = stripReaderChrome(String(group.direction ?? "").trim());
    const material = stripReaderChrome(String(group.material ?? "").trim());
    const title = instruction || `Unmapped questions (${groupType || groupId})`;
    if (instruction) {
      for (const question of questions) {
        if (!question.instruction) question.instruction = instruction;
      }
    }
    if (material) {
      for (const question of questions) {
        if (PASSAGE_KINDS.has(question.rawType ?? "")) {
          question.passage = material.slice(0, 12_000);
        }
      }
    }

    activities.push({
      anchor: `unmapped-${groupId}`,
      title,
      level: 2,
      startIndex: children.length,
      endIndex: children.length,
      questionGroups: [
        {
          groupId,
          groupType,
          ...(groupVersion ? { versionNumber: groupVersion } : {}),
          questionCount: questions.length,
          questionTypes: [...new Set(questions.map((question) => question.rawType ?? question.type))],
        },
      ],
      questions,
      ...(instruction ? { instruction } : {}),
      ...(material ? { passage: material.slice(0, 12_000) } : {}),
      unmapped: true,
    });
    warnings.push(`unmapped question group ${groupId} kept as "${title}"`);
  }

  const total = activities.reduce((sum, activity) => sum + activity.questions.length, 0);
  if (total === 0) warnings.push("no questions found in chapter structure");

  return { activities, nodes, warnings };
}

/**
 * Resolve a `getChapterInfo` payload (whose `content` is usually a signed URL)
 * into a parsed structure. The signed CDN URL is publicly readable, so no token
 * is needed for the second request.
 */
export async function loadChapterStructure(
  data: ChapterRawData,
  fetcher: typeof fetch = fetch,
): Promise<ChapterStructure> {
  const content = data.content;
  if (typeof content === "string" && /^https?:\/\//i.test(content)) {
    const response = await fetcher(content);
    if (!response.ok) {
      throw new Error(`failed to fetch chapter content: HTTP ${response.status}`);
    }
    const parsed = await response.json();
    return parseChapterStructure({ ...data, content: parsed });
  }
  return parseChapterStructure(data);
}

export function findActivityByAnchor(
  structure: ChapterStructure,
  anchor: string,
): ChapterStructureActivity | undefined {
  return structure.activities.find((activity) => activity.anchor === anchor);
}

/** Flatten every question in reading order. */
export function structureQuestions(structure: ChapterStructure): Question[] {
  return structure.activities.flatMap((activity) => activity.questions);
}
