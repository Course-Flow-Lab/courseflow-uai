// src/module.ts
import { createCipheriv as createCipheriv2, createHash as createHash2, createHmac as createHmac4 } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// src/vendor/question-kind.ts
var KIND_TABLE = {
  single_choice: {
    type: "single",
    answerMode: "option",
    fillable: true,
    hint: "\u5355\u9009\u9898\uFF1A\u8FD4\u56DE 1 \u4E2A\u9009\u9879\u7684\u5B8C\u6574\u539F\u6587\u3002"
  },
  multiple_choice: {
    type: "multiple",
    answerMode: "option",
    fillable: true,
    hint: "\u591A\u9009\u9898\uFF1A\u8FD4\u56DE\u6240\u6709\u6B63\u786E\u9009\u9879\u7684\u5B8C\u6574\u539F\u6587\u3002"
  },
  true_false: {
    type: "judge",
    answerMode: "option",
    fillable: true,
    hint: "\u5224\u65AD\u9898\uFF1A\u8FD4\u56DE\u9009\u9879\u539F\u6587\uFF08\u5982\u201C\u6B63\u786E\u201D\u201C\u9519\u8BEF\u201D\uFF09\uFF0C\u4E0D\u8981\u8FD4\u56DE T/F\u3002"
  },
  fill_blanks: {
    type: "fill",
    answerMode: "blanks",
    fillable: true,
    hint: "\u586B\u7A7A\u9898\uFF1A\u6309 {{1}}\u2026{{n}} \u7684\u987A\u5E8F\uFF0C\u6BCF\u4E2A\u7A7A\u53EA\u8FD4\u56DE\u7F3A\u5931\u7684\u8BCD\u6216\u77ED\u8BED\uFF0C\u4E0D\u8981\u91CD\u590D\u6574\u53E5\uFF0C\u4E0D\u8981\u5E26\u5E8F\u53F7\u3002"
  },
  fill_blanks_choice: {
    type: "fill",
    answerMode: "blanks",
    fillable: true,
    hint: "\u9009\u8BCD\u586B\u7A7A\uFF1A\u53EA\u80FD\u4ECE options \u8BCD\u5E93\u4E2D\u9009\u8BCD\uFF0C\u6BCF\u4E2A\u8BCD\u6700\u591A\u4F7F\u7528\u4E00\u6B21\uFF0C\u6309\u7A7A\u987A\u5E8F\u8FD4\u56DE\u3002"
  },
  translation: {
    type: "short",
    answerMode: "text",
    fillable: true,
    hint: "\u7FFB\u8BD1/\u8865\u5168\uFF1A\u82E5\u9898\u5E72\u62EC\u53F7\u5185\u6709\u4E2D\u6587\uFF0C\u53EA\u8FD4\u56DE\u8BE5\u4E2D\u6587\u5BF9\u5E94\u7684\u82F1\u6587\u8868\u8FBE\uFF1B\u82E5\u6574\u53E5\u662F\u4E2D\u6587\uFF0C\u5219\u8FD4\u56DE\u5B8C\u6574\u82F1\u6587\u8BD1\u6587\u3002\u4E0D\u8981\u89E3\u91CA\u3002"
  },
  short_answer: {
    type: "short",
    answerMode: "text",
    fillable: true,
    hint: "\u7B80\u7B54\u9898\uFF1A\u7ED3\u5408\u9898\u5E72\u4F5C\u7B54\uFF1B\u82E5\u7ED9\u4E86 passage\uFF0C\u53EA\u7528\u5176\u4E2D\u4E8B\u5B9E\uFF0C\u4E0D\u8981\u590D\u8FF0\u539F\u6587\u3002\u7B54\u6848\u8981\u7B80\u77ED\u3001\u76F4\u63A5\u3002"
  },
  writing: {
    type: "short",
    answerMode: "text",
    fillable: true,
    hint: "\u5199\u4F5C\u9898\uFF1A\u6309\u9898\u5E72\u5B57\u6570\u4E0E\u7ED3\u6784\u8981\u6C42\u5199\u5B8C\u6574\u77ED\u6587\uFF0C\u53EA\u8F93\u51FA\u6B63\u6587\u3002"
  },
  text_match: {
    type: "matching",
    answerMode: "pairs",
    fillable: true,
    requiresDrag: true,
    hint: "\u5339\u914D\u9898\uFF1A\u6309 pairs[].left \u7684\u987A\u5E8F\uFF0C\u8FD4\u56DE\u6BCF\u4E2A\u5DE6\u4FA7\u9879\u5BF9\u5E94\u7684\u53F3\u4FA7\u9009\u9879\u539F\u6587\u3002"
  },
  oral_personal_state: {
    type: "speaking",
    answerMode: "none",
    fillable: false,
    hint: ""
  },
  multi_media_upload: {
    type: "upload",
    answerMode: "none",
    fillable: false,
    hint: ""
  },
  discussion: {
    type: "discussion",
    answerMode: "none",
    fillable: false,
    hint: ""
  },
  rich_text_read: {
    type: "reading",
    answerMode: "none",
    fillable: false,
    hint: ""
  },
  rich_text_read_group: {
    type: "reading",
    answerMode: "none",
    fillable: false,
    hint: ""
  }
};
var NON_FILLABLE = /* @__PURE__ */ new Set([
  "oral_personal_state",
  "multi_media_upload",
  "discussion",
  "rich_text_read",
  "rich_text_read_group"
]);
function classifyQuestion(rawType) {
  const raw = (rawType ?? "").trim();
  const known = KIND_TABLE[raw];
  if (known) {
    return { rawType: raw, requiresDrag: false, ...known };
  }
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
        hint: ""
      };
    }
  }
  return {
    rawType: raw,
    type: "unknown",
    answerMode: "none",
    fillable: false,
    requiresDrag: false,
    hint: ""
  };
}
function stripReaderChrome(input) {
  return input.replace(/\b(?:自动判题|计分|提交|预览|打开精读模式)\b/g, " ").replace(/\d+\s*\/\s*10000/g, " ").replace(/准备时长\s*\d{1,2}:\d{2}/g, " ").replace(/作答时长\s*\d{1,2}:\d{2}/g, " ").replace(/点击开始(?:录制|作答)?/g, " ").replace(/\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}/g, " ").replace(/\s+/g, " ").trim();
}

// src/vendor/paper.ts
function lexicalText(value) {
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
    const node = value;
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.children)) {
      return node.children.map((item) => lexicalText(item)).join("");
    }
    if (node.root) return lexicalText(node.root);
  }
  return "";
}
function parsePaperData(input) {
  const data = input ?? {};
  const groups = data.bigQuestionGroupDTOs ?? [];
  const questions = [];
  const usedIds = /* @__PURE__ */ new Set();
  for (const group of groups) {
    const groupId = String(group.groupId ?? "");
    const material = group.material ? lexicalText(group.material) : void 0;
    const list = group.list ?? [];
    for (const raw of list) {
      const rawType = String(raw.questionType ?? group.groupType ?? "");
      const kind = classifyQuestion(rawType);
      const type = kind.type;
      const children = raw.children ?? [];
      const child = children[0] ?? raw;
      const stem = String(
        raw.quesTextString ?? lexicalText(raw.quesText) ?? ""
      ).trim();
      if (!stem) continue;
      const options = ((child.options ?? []).length > 0 ? child.options : raw.options ?? []).map((option, index) => ({
        index,
        text: rawType === "fill_blanks_choice" && option.label ? String(option.label).trim() : lexicalText(option.optionValue) || String(option.label ?? "").trim(),
        ...option.optionId ? { value: String(option.optionId) } : {},
        ...option.label ? { label: String(option.label) } : {},
        ...option.optionId ? { optionId: String(option.optionId) } : {}
      }));
      const childIds = children.map((item) => item.childId ? String(item.childId) : "").filter(Boolean);
      const baseId = String(raw.id ?? child.childId ?? `q${questions.length + 1}`);
      const id = usedIds.has(baseId) ? `${groupId}:${baseId}` : baseId;
      usedIds.add(id);
      const question = {
        id,
        index: questions.length,
        type,
        stem,
        options,
        blankCount: kind.answerMode === "blanks" || kind.answerMode === "text" ? Math.max(children.length, 1) : 0,
        answerMode: kind.answerMode,
        groupId,
        rawType,
        ...children.length > 0 ? {
          blanks: children.map((item, position) => ({
            ...item.childId ? { id: String(item.childId) } : {},
            index: position + 1
          }))
        } : {},
        ...child.childId ? { childId: String(child.childId) } : {},
        ...childIds.length > 0 ? { childIds } : {},
        ...options.some((option) => option.value) ? {
          optionIds: options.map((option) => String(option.value ?? ""))
        } : {}
      };
      if (material) question.passage = material;
      if (typeof raw.score === "number") question.score = raw.score;
      questions.push(question);
    }
  }
  return {
    instanceId: data.instanceId ? String(data.instanceId) : void 0,
    paperId: String(data.paperId ?? ""),
    paperName: String(data.paperName ?? ""),
    paperType: Number(data.paperType ?? 0),
    versionNumber: String(data.versionNumber ?? ""),
    questionCount: Number(data.questionCount ?? questions.length),
    totalScore: Number(data.totalScore ?? 0),
    questions
  };
}

// src/vendor/chapter-structure.ts
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseMaybeJson(value) {
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
function anchorOf(node) {
  const raw = node.$?.__anchor__ ?? node.id;
  return typeof raw === "string" && raw.length > 0 ? raw : void 0;
}
function headingLevelOf(node) {
  if (node.type !== "heading") return void 0;
  const match = typeof node.tag === "string" ? node.tag.match(/^h([1-6])$/i) : null;
  return match ? Number(match[1]) : 2;
}
function cleanInline(text) {
  return text.replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function lexicalToStem(value) {
  const blanks = [];
  const parts = [];
  const parsed = parseMaybeJson(value);
  const walk = (node) => {
    if (node === null || node === void 0) return;
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
          ...node.id ? { id: String(node.id) } : {},
          index
        });
        parts.push(`{{${index}}}`);
        return;
      }
      case "insert-image":
        parts.push(" [\u56FE\u7247] ");
        return;
      case "insert-video":
        parts.push(" [\u89C6\u9891] ");
        return;
      case "insert-audio":
        parts.push(" [\u97F3\u9891] ");
        return;
      default:
        if (node.root) walk(node.root);
        else if (Array.isArray(node.children)) node.children.forEach(walk);
    }
  };
  walk(parsed);
  return { text: cleanInline(parts.join("")), blanks };
}
function optionText(option) {
  const fromValue = lexicalText(option.optionValue);
  if (fromValue.trim()) return fromValue.trim();
  return String(option.label ?? "").trim();
}
function buildOptions(raw, child, groupType, rawType) {
  const source = Array.isArray(child?.options) && child.options.length > 0 ? child.options : Array.isArray(raw.options) ? raw.options : [];
  return source.map((option, index) => {
    const label = String(option.label ?? "").trim();
    const text = rawType === "fill_blanks_choice" && label ? label : optionText(option) || label;
    const mapped = { index, text };
    if (label) mapped.label = label;
    if (option.optionId) mapped.value = String(option.optionId);
    if (option.optionId) mapped.optionId = String(option.optionId);
    return mapped;
  }).filter((option) => option.text.length > 0);
}
function buildPairs(children) {
  return children.map((child) => ({
    ...child.childId ? { id: String(child.childId) } : {},
    left: lexicalText(child.quesText).trim() || String(child.quesTextString ?? "").trim()
  })).filter((pair) => pair.left.length > 0);
}
function buildStructureQuestion(raw, groupId, groupType, index = 0, groupVersion) {
  if (!isObject(raw)) return null;
  const children = Array.isArray(raw.children) ? raw.children : [];
  const child = children[0];
  const rawType = String(raw.questionType ?? groupType ?? "");
  const kind = classifyQuestion(rawType);
  const { text: lexicalStem, blanks: lexicalBlanks } = lexicalToStem(raw.quesText);
  const pairs = kind.answerMode === "pairs" ? buildPairs(children) : [];
  const childStem = children.map((item) => {
    const text = lexicalToStem(item.quesText).text;
    return text || String(item.quesTextString ?? "");
  }).find((text) => text.trim().length > 0);
  let stem = stripReaderChrome(
    lexicalStem || String(raw.quesTextString ?? "") || childStem || ""
  );
  if (!stem && pairs.length > 0) {
    stem = `Match each item with the correct option: ${pairs.map((pair) => pair.left).join(" / ")}`;
  }
  if (!stem) return null;
  const blanks = lexicalBlanks.length > 0 ? lexicalBlanks : children.map((item, position) => ({
    ...item.childId ? { id: String(item.childId) } : {},
    index: position + 1
  }));
  const childIds = children.map((item) => item.childId ? String(item.childId) : "").filter(Boolean);
  const options = kind.answerMode === "option" || kind.answerMode === "pairs" || rawType === "fill_blanks_choice" ? buildOptions(raw, child, groupType, rawType) : [];
  const question = {
    id: String(raw.id ?? child?.childId ?? `${groupId}:${index}`),
    index,
    type: kind.type,
    stem,
    options,
    blankCount: kind.answerMode === "blanks" || kind.answerMode === "text" ? Math.max(blanks.length, 1) : 0,
    answerMode: kind.answerMode,
    rawType,
    groupId,
    ...groupVersion ? { groupVersion } : {},
    ...childIds.length > 0 ? { childIds } : {}
  };
  if (blanks.length > 0 && (kind.answerMode === "blanks" || kind.answerMode === "text")) {
    question.blanks = blanks;
  }
  if (pairs.length > 0) question.pairs = pairs;
  if (typeof raw.score === "number") question.score = raw.score;
  return question;
}
function normalizeGroup(raw) {
  const value = parseMaybeJson(raw);
  if (!isObject(value)) return null;
  if (!Array.isArray(value.list)) return null;
  return value;
}
function groupKey(group) {
  return String(group.groupId ?? "");
}
function readingMaterial(group) {
  const list = Array.isArray(group.list) ? group.list : [];
  const paragraphs = [];
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
var GENERIC_STEMS = /^(?:provide your answer here\.?|请在此处作答\.?)$/i;
var PASSAGE_KINDS = /* @__PURE__ */ new Set([
  "fill_blanks",
  "fill_blanks_choice",
  "single_choice",
  "multiple_choice",
  "true_false",
  "text_match"
]);
function parseChapterStructure(input) {
  const warnings = [];
  const groups = /* @__PURE__ */ new Map();
  const consumed = /* @__PURE__ */ new Set();
  for (const raw of Array.isArray(input.questionList) ? input.questionList : []) {
    const group = normalizeGroup(raw);
    if (group && groupKey(group)) groups.set(groupKey(group), group);
  }
  const content = parseMaybeJson(input.content);
  const root = isObject(content) && isObject(content.root) ? content.root : content;
  const children = isObject(root) && Array.isArray(root.children) ? root.children : [];
  if (children.length === 0) {
    warnings.push("chapter content has no renderable nodes");
    return { activities: [], nodes: [], warnings };
  }
  const nodes = children.map((node, index) => {
    const headingLevel = headingLevelOf(node);
    const text = node.type === "question-block" ? "" : cleanInline(lexicalText(node));
    return {
      index,
      type: String(node.type ?? "unknown"),
      ...anchorOf(node) ? { anchor: anchorOf(node) } : {},
      ...headingLevel ? { headingLevel } : {},
      ...typeof node.tag === "string" ? { tag: node.tag } : {},
      text,
      ...node.questionType ? { questionType: String(node.questionType) } : {},
      ...node.questionGroup ? { questionGroupId: String(node.questionGroup) } : {}
    };
  });
  const activities = [];
  const passageStack = [];
  const headingStack = [];
  let current = null;
  let instructionParts = [];
  const activePassage = () => {
    const entry = passageStack[passageStack.length - 1];
    return entry ? { text: entry.text, anchor: entry.anchor } : void 0;
  };
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    const info = nodes[index];
    if (node.type === "heading") {
      if (current) current.endIndex = index;
      const level = info.headingLevel ?? 2;
      while (headingStack.length > 0 && headingStack[headingStack.length - 1] >= level) {
        headingStack.pop();
      }
      const parentLevel = headingStack[headingStack.length - 1];
      headingStack.push(level);
      while (passageStack.length > 0 && passageStack[passageStack.length - 1].ownerLevel >= level) {
        passageStack.pop();
      }
      current = {
        anchor: info.anchor ?? `heading-${index}`,
        title: info.text,
        level,
        ...parentLevel !== void 0 ? { parentLevel } : {},
        startIndex: index,
        endIndex: children.length,
        questionGroups: [],
        questions: []
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
            text: text.slice(0, 12e3),
            anchor: current.anchor
          });
        } else {
          warnings.push(`block #${index}: reading material too short to use as passage`);
        }
        continue;
      }
      const list = Array.isArray(group?.list) ? group.list : [];
      const questions = [];
      const groupVersion = group?.versionNumber ? String(group.versionNumber) : void 0;
      for (const raw of list) {
        const question = buildStructureQuestion(
          raw,
          groupId,
          groupType,
          current.questions.length,
          groupVersion
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
        ...groupVersion ? { versionNumber: groupVersion } : {},
        questionCount: questions.length,
        questionTypes
      });
      instructionParts = [];
      continue;
    }
    if (info.text) instructionParts.push(info.text);
  }
  if (current) current.endIndex = children.length;
  for (const [groupId, group] of groups) {
    if (consumed.has(groupId)) continue;
    const list = Array.isArray(group.list) ? group.list : [];
    const groupType = String(group.groupType ?? "");
    const groupVersion = group.versionNumber ? String(group.versionNumber) : void 0;
    const questions = [];
    for (const raw of list) {
      const question = buildStructureQuestion(
        raw,
        groupId,
        groupType,
        questions.length,
        groupVersion
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
          question.passage = material.slice(0, 12e3);
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
          ...groupVersion ? { versionNumber: groupVersion } : {},
          questionCount: questions.length,
          questionTypes: [...new Set(questions.map((question) => question.rawType ?? question.type))]
        }
      ],
      questions,
      ...instruction ? { instruction } : {},
      ...material ? { passage: material.slice(0, 12e3) } : {},
      unmapped: true
    });
    warnings.push(`unmapped question group ${groupId} kept as "${title}"`);
  }
  const total = activities.reduce((sum, activity) => sum + activity.questions.length, 0);
  if (total === 0) warnings.push("no questions found in chapter structure");
  return { activities, nodes, warnings };
}
async function loadChapterStructure(data, fetcher = fetch) {
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

// src/vendor/parser/normalize.ts
function normalizeText(input) {
  return input.replace(/\u00a0/g, " ").replace(
    /[\uff01-\uff5e]/g,
    (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)
  ).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim().toLowerCase().replace(/[.,;:!?'"()[\]{}<>/\\|`~@#$%^&*+=_-]/g, "").replace(/\s+/g, " ").trim();
}
function isBareOptionLetter(text) {
  return /^[a-dA-D]$/.test(text.trim());
}

// src/vendor/matcher.ts
var TRUE_WORDS = /* @__PURE__ */ new Set(["\u5BF9", "\u6B63\u786E", "\u662F", "true", "t", "yes", "y"]);
var FALSE_WORDS = /* @__PURE__ */ new Set(["\u9519", "\u9519\u8BEF", "\u5426", "false", "f", "no", "n"]);
function judgeValue(text) {
  const value = text.trim().toLowerCase();
  if (TRUE_WORDS.has(value)) return "true";
  if (FALSE_WORDS.has(value)) return "false";
  return null;
}
function tokens(text) {
  const normalized = normalizeText(text);
  if (!normalized) return /* @__PURE__ */ new Set();
  if (normalized.includes(" ")) {
    return new Set(normalized.split(" ").filter(Boolean));
  }
  const chars = [...normalized];
  const grams = new Set(chars);
  for (let i = 0; i < chars.length - 1; i += 1) {
    grams.add(chars[i] + chars[i + 1]);
  }
  return grams;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}
function similarity(left, right) {
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
function matchOption(answerText, options, threshold = 0.6) {
  if (isBareOptionLetter(answerText)) return null;
  let best = null;
  for (const option of options) {
    if (!option.text) continue;
    const score = similarity(answerText, option.text);
    if (!best || score > best.score) best = { option, score };
  }
  if (!best || best.score < threshold) return null;
  return best;
}

// src/vendor/submit-signature.ts
import { createHmac } from "node:crypto";
var PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43];
function primeSkip(key, length) {
  if (!key) throw new Error("primeSkip: empty key");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < length; index += 1) {
    offset = (offset + PRIMES[index % PRIMES.length]) % key.length;
    bytes[index] = key.charCodeAt(offset) + index & 255;
  }
  return bytes;
}
function hotpSha1(key, counter, modDivisor = 1e6) {
  const buffer = Buffer.alloc(8);
  let value = BigInt(Math.floor(counter));
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  const digest = createHmac("sha1", Buffer.from(key)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest[offset] & 127) << 24 | (digest[offset + 1] & 255) << 16 | (digest[offset + 2] & 255) << 8 | digest[offset + 3] & 255;
  return String(code % modDivisor).padStart(6, "0");
}
function buildSubmitSignature(input) {
  const openIdSum = input.openId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const keyLength = openIdSum % 10 + 4;
  const keyString = `${input.authorization}|${input.referer}`;
  const keyBytes = primeSkip(keyString, keyLength);
  return hotpSha1(keyBytes, input.timestamp);
}
function decodeJwtPayload(token) {
  const raw = token.replace(/^Bearer\s+/i, "").trim();
  const parts = raw.split(".");
  if (parts.length < 2) throw new Error("not a JWT");
  const payload = parts[1];
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  );
}
function readOpenId(token) {
  const payload = decodeJwtPayload(token);
  const openId = payload.openId ?? payload.sub ?? payload.boid;
  if (typeof openId !== "string" || !openId) {
    throw new Error("reader token has no openId/sub/boid");
  }
  return openId;
}

// src/vendor/chapter-api.ts
var DEFAULT_BASE_URL = "https://ipub.unipus.cn";
function authHeader(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}
function baseHeaders(token) {
  return {
    authorization: authHeader(token),
    lovefrom: "learner",
    accept: "application/json, text/plain, */*",
    "content-type": "application/json"
  };
}
function signedHeaders(token, referer, timestamp, openId) {
  const authorization = authHeader(token);
  const v = buildSubmitSignature({
    authorization,
    openId: openId ?? readOpenId(token),
    referer,
    timestamp
  });
  return {
    ...baseHeaders(token),
    "x-referer": referer,
    v
  };
}
function buildChapterReferer(ids) {
  return `https://ipub.unipus.cn/learner/textbook/book/${ids.bookId}/chapter/${ids.chapterId}?bookVersionNumber=${ids.bookVersionNumber}`;
}
function chapterVersionFromContent(content) {
  if (typeof content !== "string") return void 0;
  const match = content.match(/\/([^/]+)\/studentContent\.json/);
  return match?.[1];
}
async function fetchChapterStructure(options, ids, fetcher = fetch) {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const query = new URLSearchParams({
    bookId: ids.bookId,
    bookVersionNumber: ids.bookVersionNumber,
    chapterId: ids.chapterId
  });
  const response = await fetcher(
    `${baseUrl}/api/reader/chapter/getChapterInfo?${query.toString()}`,
    { headers: baseHeaders(options.token) }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `getChapterInfo failed: HTTP ${response.status} ${text.slice(0, 200)}`
    );
  }
  const json = JSON.parse(text);
  if (json.code !== void 0 && json.code !== 200) {
    throw new Error(
      `getChapterInfo rejected: code ${json.code} ${text.slice(0, 200)}`
    );
  }
  const data = json.data ?? {};
  const structure = await loadChapterStructure(data, fetcher);
  const chapterVersionNumber = (data.chapterVersionNumber ? String(data.chapterVersionNumber) : void 0) ?? (data.versionNumber ? String(data.versionNumber) : void 0) ?? chapterVersionFromContent(data.content);
  return {
    structure,
    ...chapterVersionNumber ? { chapterVersionNumber } : {},
    raw: data
  };
}
function optionIdOf(question, text) {
  const match = matchOption(text, question.options);
  if (!match) return void 0;
  return match.option.optionId ?? match.option.value;
}
var AI_GRADED = /* @__PURE__ */ new Set([
  "writing",
  "short_answer",
  "translation",
  "oral_personal_state"
]);
function judgeable(extraTypes) {
  if (!extraTypes || extraTypes.length === 0) return AI_GRADED;
  return /* @__PURE__ */ new Set([...AI_GRADED, ...extraTypes]);
}
function buildChapterSubmissions(questions, answers) {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const groups = /* @__PURE__ */ new Map();
  const warnings = [];
  const merge = (question, records) => {
    const groupId = question.groupId;
    const versionNumber = question.groupVersion;
    const answeredJudge = records.some(
      (record) => record.userAnswerValue !== "" && AI_GRADED.has(record.questionType) && // Zero-point questions (short_answer / discussion prompts) are never
      // AI-graded by the platform: `judgeStart` answers with an empty
      // `judgeTaskList`, and the answer only needs a plain `submitScore`.
      question.score !== 0
    );
    if (question.score === 0 && records.some(
      (record) => record.userAnswerValue !== "" && AI_GRADED.has(record.questionType)
    )) {
      warnings.push(
        `${question.id}: 0-point ${question.rawType ?? question.type}; submitted without AI grading`
      );
    }
    const existing = groups.get(groupId);
    if (!existing) {
      groups.set(groupId, {
        groupId,
        versionNumber,
        mode: answeredJudge ? "judge" : "score",
        userAnswers: records
      });
      return;
    }
    if (existing.versionNumber !== versionNumber) {
      warnings.push(
        `${question.id}: group version mismatch (${existing.versionNumber} != ${versionNumber})`
      );
    }
    if (answeredJudge) existing.mode = "judge";
    existing.userAnswers.push(...records);
  };
  const pushAll = (question, values) => {
    merge(
      question,
      values.map(({ childId, value }) => ({
        childId,
        questionType: question.rawType ?? question.type,
        userAnswerValue: value,
        questionId: question.id
      }))
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
    const blankIds = childIds.length > 0 ? childIds : (question.blanks ?? []).map((blank) => blank.id).filter((id) => Boolean(id));
    const answer = byId.get(question.id);
    const answered = Boolean(answer && answer.texts.length > 0);
    if (!answered) {
      const emptyIds = kind.answerMode === "pairs" ? (question.pairs ?? []).map((pair) => pair.id).filter((id) => Boolean(id)) : blankIds.length > 0 ? blankIds : [question.id];
      pushAll(
        question,
        emptyIds.map((childId) => ({ childId, value: "" }))
      );
      continue;
    }
    const texts = answer.texts;
    if (kind.answerMode === "option") {
      const ids = texts.map((text) => optionIdOf(question, text)).filter((id) => Boolean(id));
      if (ids.length === 0) {
        warnings.push(
          `${question.id}: no option id matched [${texts.join(" | ")}]`
        );
        continue;
      }
      const value = questionType === "true_false" ? ids[0] ?? "" : JSON.stringify(ids);
      pushAll(question, [{ childId: blankIds[0] ?? question.id, value }]);
      continue;
    }
    if (kind.answerMode === "pairs") {
      const pairs = question.pairs ?? [];
      const values = [];
      for (let index = 0; index < pairs.length; index += 1) {
        const pair = pairs[index];
        if (!pair.id) continue;
        const text = texts[index];
        if (!text) {
          values.push({ childId: pair.id, value: "" });
          continue;
        }
        const optionId = optionIdOf(question, text);
        if (!optionId) {
          warnings.push(
            `${question.id}: pair ${index + 1} "${text}" did not match any option`
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
          value: texts[index] ?? ""
        }))
      );
      continue;
    }
    if (kind.answerMode === "text") {
      pushAll(question, [
        { childId: blankIds[0] ?? question.id, value: texts.join("\n") }
      ]);
      continue;
    }
    pushAll(
      question,
      (blankIds.length > 0 ? blankIds : [question.id]).map((childId) => ({
        childId,
        value: ""
      }))
    );
  }
  const submissions = [];
  for (const group of groups.values()) {
    if (!group.userAnswers.some((record) => record.userAnswerValue !== "")) {
      warnings.push(`${group.groupId}: no answered questions; skipped`);
      continue;
    }
    submissions.push(group);
  }
  return { submissions, warnings };
}
function buildChapterSubmitPayload(meta, submission) {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  return {
    groupId: submission.groupId,
    userAnswers: submission.userAnswers.map(
      ({ childId, questionType, userAnswerValue, bizAnswerId }) => ({
        childId,
        questionType,
        userAnswerValue,
        ...bizAnswerId ? { bizAnswerId } : {}
      })
    ),
    versionNumber: submission.versionNumber,
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersionNumber,
    chapterId: meta.chapterId,
    chapterVersionNumber: meta.chapterVersionNumber,
    a,
    b
  };
}
function buildChapterJudgePayload(meta, submission, extraTypes) {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  const allowed = judgeable(extraTypes);
  return {
    groupId: submission.groupId,
    lan: "en",
    userAnswers: submission.userAnswers.filter(
      (record) => allowed.has(record.questionType) && record.userAnswerValue !== ""
    ),
    versionNumber: submission.versionNumber,
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersionNumber,
    chapterId: meta.chapterId,
    chapterVersionNumber: meta.chapterVersionNumber,
    a,
    b
  };
}
function buildChapterJudgeResultPayload(submission, bizAnswerIds, extraTypes) {
  const allowed = judgeable(extraTypes);
  const userAnswers = submission.userAnswers.filter(
    (record) => allowed.has(record.questionType) && record.userAnswerValue !== "" && bizAnswerIds[record.childId]
  ).map((record) => ({
    questionId: record.questionId,
    childId: record.childId,
    questionType: record.questionType,
    userAnswerValue: record.userAnswerValue,
    bizAnswerId: bizAnswerIds[record.childId]
  }));
  return { userAnswers, versionNumber: submission.versionNumber };
}
function buildChapterJudgeSubmitPayload(meta, submission, bizAnswerIds) {
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
        ...bizAnswerId ? {
          ...record.questionId ? { questionId: record.questionId } : {},
          bizAnswerId
        } : {}
      };
    }),
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersionNumber,
    chapterId: meta.chapterId,
    chapterVersionNumber: meta.chapterVersionNumber,
    a,
    b
  };
}
async function postJson(options, path, meta, payload, fetcher) {
  const a = Number(payload.a ?? Date.now());
  const response = await fetcher(`${options.baseUrl ?? DEFAULT_BASE_URL}${path}`, {
    method: "POST",
    headers: signedHeaders(options.token, meta.referer, a, meta.openId),
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = void 0;
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
    ...json !== void 0 ? { json } : {},
    payload
  };
}
async function submitChapterScore(options, meta, submission, fetcher = fetch) {
  return postJson(
    options,
    "/api/reader/answer/submitScore",
    meta,
    buildChapterSubmitPayload(meta, submission),
    fetcher
  );
}
function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}
async function submitChapterJudge(options, meta, submission, judgeOptions = {}) {
  const fetcher = judgeOptions.fetcher ?? fetch;
  const sleep = judgeOptions.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollIntervalMs = judgeOptions.pollIntervalMs ?? 1500;
  const maxAttempts = judgeOptions.maxAttempts ?? 20;
  const warnings = [];
  const responses = {};
  const judgeSubmission = {
    ...submission,
    userAnswers: submission.userAnswers.filter(
      (record) => judgeable(judgeOptions.extraQuestionTypes).has(record.questionType) && record.userAnswerValue !== ""
    )
  };
  if (judgeSubmission.userAnswers.length === 0) {
    const score2 = await submitChapterScore(options, meta, submission, fetcher);
    responses.score = score2;
    return {
      judgeTaskList: [],
      results: [],
      ...typeof asRecord(score2.json).data?.score === "number" ? { score: asRecord(score2.json).data.score } : {},
      polls: 0,
      warnings: ["no AI-graded answers; used submitScore directly"],
      responses
    };
  }
  const start = await postJson(
    options,
    "/api/reader/answer/judgeStart",
    meta,
    buildChapterJudgePayload(
      meta,
      judgeSubmission,
      judgeOptions.extraQuestionTypes
    ),
    fetcher
  );
  responses.start = start;
  if (!start.ok) {
    warnings.push(`judgeStart failed: HTTP ${start.status} ${start.body.slice(0, 160)}`);
    return { judgeTaskList: [], results: [], polls: 0, warnings, responses };
  }
  const taskList = asRecord(asRecord(start.json).data).judgeTaskList;
  const judgeTaskList = Array.isArray(taskList) ? taskList.map((task) => ({
    childId: String(task?.childId ?? ""),
    bizAnswerId: String(task?.bizAnswerId ?? "")
  })).filter((task) => task.childId && task.bizAnswerId) : [];
  const bizAnswerIds = {};
  for (const task of judgeTaskList) bizAnswerIds[task.childId] = task.bizAnswerId;
  if (judgeTaskList.length === 0) {
    warnings.push("judgeStart returned no judgeTaskList");
  }
  let results = [];
  let polls = 0;
  for (let attempt = 0; judgeTaskList.length > 0 && attempt < maxAttempts; attempt += 1) {
    await sleep(pollIntervalMs);
    const poll = await postJson(
      options,
      "/api/reader/answer/judgeResult",
      meta,
      buildChapterJudgeResultPayload(
        judgeSubmission,
        bizAnswerIds,
        judgeOptions.extraQuestionTypes
      ),
      fetcher
    );
    polls += 1;
    responses.result = poll;
    if (!poll.ok) {
      warnings.push(`judgeResult failed: HTTP ${poll.status}`);
      break;
    }
    const items = asRecord(asRecord(poll.json).data).userAnswersResult;
    if (Array.isArray(items) && items.length > 0) {
      results = items;
      const done = results.every(
        (item) => Boolean(item.evaluation) || (item.status ?? 0) !== 0
      );
      if (done) break;
    }
  }
  if (results.length > 0 && !results.every((item) => Boolean(item.evaluation))) {
    warnings.push("judgeResult did not return an evaluation before timeout");
  }
  const score = await postJson(
    options,
    "/api/reader/answer/submitScore",
    meta,
    buildChapterJudgeSubmitPayload(meta, submission, bizAnswerIds),
    fetcher
  );
  responses.score = score;
  if (!score.ok) {
    warnings.push(`submitScore failed: HTTP ${score.status}`);
  }
  const scoreValue = asRecord(asRecord(score.json).data).score;
  return {
    judgeTaskList,
    results,
    ...typeof scoreValue === "number" ? { score: scoreValue } : {},
    polls,
    warnings,
    responses
  };
}
async function fetchChapterAnswerList(options, groupId, versionNumber, fetcher = fetch) {
  const url = `${options.baseUrl ?? DEFAULT_BASE_URL}/api/reader/answer/list?questionId=${encodeURIComponent(groupId)}&versionNumber=${encodeURIComponent(versionNumber)}`;
  const response = await fetcher(url, {
    method: "GET",
    headers: {
      authorization: authHeader(options.token),
      lovefrom: "learner",
      accept: "application/json"
    }
  });
  const body = await response.text();
  let data;
  try {
    const json = JSON.parse(body);
    if (json.code === 200 && json.data) data = json.data;
  } catch {
    data = void 0;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    ...data ? { data } : {}
  };
}
async function finishChapterNode(options, meta, node, fetcher = fetch) {
  const a = meta.timestamp ?? Date.now();
  const b = meta.endTimestamp ?? a;
  return postJson(
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
      b
    },
    fetcher
  );
}

// src/vendor/cas-login.ts
import { createCipheriv, createHmac as createHmac2 } from "node:crypto";
var LOGIN_AES_KEY = Buffer.from(
  "8AD70B641C024C7ADA2ECD082EC0334F",
  "hex"
);
var LOGIN_AES_IV = Buffer.from("0102030405060708090A0B0C0D0E0F10", "hex");
var ANNOTATOR_SECRET = "a824b379f126b8b7aa5e33dee83fb0a05aa7462c";
function signAnnotatorToken(openId, now = Date.now()) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      open_id: openId,
      name: "",
      email: "",
      administrator: false,
      exp: now + 31536e6,
      iss: "c4f772063dcfa98e9c50",
      aud: "edx.unipus.cn"
    })
  ).toString("base64url");
  const signature = createHmac2("sha256", ANNOTATOR_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

// src/vendor/video.ts
var DEFAULT_CONTENT_BASE_URL = "https://ucontent.unipus.cn";
var DEFAULT_READER_BASE_URL = "https://ipub.unipus.cn";
function authHeaderValue(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}
function rawToken(token) {
  return token.replace(/^Bearer\s+/i, "").trim();
}
async function fetchCourseTree(options, fetcher = fetch) {
  const base = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const response = await fetcher(
    `${base}/course/api/course/${options.courseId}/default`,
    {
      headers: {
        cookie: options.cookie,
        authorization: rawToken(options.token),
        accept: "application/json"
      }
    }
  );
  const text = await response.text();
  const json = JSON.parse(text);
  if (json.course) {
    const parsed = JSON.parse(json.course);
    return Array.isArray(parsed) ? parsed : parsed.units ?? [];
  }
  throw new Error(`fetchCourseTree: ${json.msg ?? `code ${json.code}`}`);
}
async function fetchUnitProgress(options, fetcher = fetch) {
  const base = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const response = await fetcher(
    `${base}/course/api/v2/course_progress/${options.courseId}/${options.unit}/${options.openId}/default`,
    {
      headers: {
        cookie: options.cookie,
        authorization: rawToken(options.token),
        "x-annotator-auth-token": signAnnotatorToken(options.openId),
        accept: "application/json"
      }
    }
  );
  const json = await response.json();
  if (!json.rt) throw new Error(`fetchUnitProgress: ${json.msg ?? `code ${json.code}`}`);
  const leafs = {};
  for (const [id, leaf] of Object.entries(json.rt.leafs ?? {})) {
    leafs[id] = {
      ...leaf.state?.pass !== void 0 ? { pass: leaf.state.pass } : {},
      ...leaf.state?.pass2 !== void 0 ? { pass2: leaf.state.pass2 } : {}
    };
  }
  return leafs;
}
async function fetchVideoDurations(options, fetcher = fetch) {
  const base = options.baseUrl ?? DEFAULT_READER_BASE_URL;
  const response = await fetcher(
    `${base}/api/reader/chapter/getBookResource?bookId=${encodeURIComponent(options.bookId)}&bookVersionNumber=${encodeURIComponent(options.bookVersionNumber)}`,
    {
      headers: {
        authorization: authHeaderValue(options.token),
        lovefrom: "learner",
        accept: "application/json"
      }
    }
  );
  const json = await response.json();
  if (!json.data?.resourceList) {
    throw new Error(`fetchVideoDurations: ${json.message ?? `code ${json.code}`}`);
  }
  const durations = /* @__PURE__ */ new Map();
  for (const entry of json.data.resourceList) {
    const chapterId = entry.chapterId;
    if (!chapterId || !entry.resource) continue;
    let parsed;
    try {
      parsed = JSON.parse(entry.resource);
    } catch {
      continue;
    }
    for (const item of parsed.resources ?? []) {
      const resource = typeof item === "string" ? safeJson(item) : item;
      if (!resource || resource.type !== "insert-video") continue;
      const anchor = resource.$?.__anchor__;
      const rawDuration = resource.mediaFile?.duration;
      const durationMs = Number(rawDuration);
      if (typeof anchor !== "string" || !Number.isFinite(durationMs) || durationMs <= 0) {
        continue;
      }
      durations.set(anchor, {
        chapterId,
        durationMs,
        ...resource.mediaFile?.mediaName ? { name: String(resource.mediaFile.mediaName) } : {}
      });
    }
  }
  return durations;
}
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
async function markVideoWatched(options, video, fetcher = fetch) {
  const now = Date.now();
  const dwell = video.durationMs + (video.extraMs ?? 1e3);
  const referer = buildChapterReferer({
    bookId: video.bookId,
    bookVersionNumber: video.bookVersionNumber,
    chapterId: video.chapterId
  });
  return finishChapterNode(
    options,
    {
      bookId: video.bookId,
      bookVersionNumber: video.bookVersionNumber,
      chapterId: video.chapterId,
      chapterVersionNumber: video.chapterVersionNumber,
      referer,
      timestamp: now - dwell,
      endTimestamp: now
    },
    { nodeId: video.anchor, nodeType: "insert-video" },
    fetcher
  );
}

// src/vendor/reading.ts
var TEXT_LEAF_BASES = [
  "base-paragraph",
  "list",
  "collapsible-block",
  "rich_text_read"
];
async function markNodeRead(options, node, fetcher = fetch) {
  const now = Date.now();
  const dwell = Math.max(1e3, node.dwellMs);
  const nodeType = node.nodeType === "rich_text_read" ? "question-block" : node.nodeType;
  return finishChapterNode(
    options,
    {
      bookId: node.bookId,
      bookVersionNumber: node.bookVersionNumber,
      chapterId: node.chapterId,
      chapterVersionNumber: node.chapterVersionNumber,
      referer: buildChapterReferer({
        bookId: node.bookId,
        bookVersionNumber: node.bookVersionNumber,
        chapterId: node.chapterId
      }),
      timestamp: now - dwell,
      endTimestamp: now
    },
    { nodeId: node.anchor, nodeType },
    fetcher
  );
}

// src/vendor/paper-api.ts
function buildPaperAnswerMap(paper, answers) {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const map = {};
  for (const question of paper.questions) {
    const answer = byId.get(question.id);
    const texts = answer?.texts ?? [];
    const records = [];
    if (question.type === "single" || question.type === "multiple" || question.type === "judge") {
      const optionIds = texts.map(
        (text) => question.options.find((option) => option.text === text)?.value ?? ""
      ).filter(Boolean);
      records.push({
        childId: question.childId ?? "",
        questionType: question.rawType,
        userAnswerValue: JSON.stringify(optionIds)
      });
    } else {
      const childIds = question.childIds ?? [];
      if (childIds.length > 1) {
        childIds.forEach((childId, index) => {
          records.push({
            childId,
            questionType: question.rawType,
            userAnswerValue: texts[index] ?? ""
          });
        });
      } else {
        records.push({
          childId: question.childId ?? "",
          questionType: question.rawType,
          userAnswerValue: texts.join("\n")
        });
      }
    }
    map[question.groupId] = [...map[question.groupId] ?? [], ...records];
  }
  return map;
}
function buildPaperSavePayload(paper, answers, testMode = 1) {
  if (!paper.instanceId) {
    throw new Error("paper.instanceId is required for saving answers");
  }
  return {
    instanceId: paper.instanceId,
    paperType: paper.paperType,
    testMode,
    baseInstanceId: paper.instanceId,
    userAnswerParamsMap: buildPaperAnswerMap(paper, answers)
  };
}
function buildPaperSubmitPayload(paper, answers, testMode = 1, timestamp = Date.now()) {
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
    b: timestamp
  };
}

// src/vendor/quiz.ts
var DEFAULT_BASE_URL2 = "https://ipub.unipus.cn";
function collectQuizLinks(units) {
  const links = [];
  const walk = (unit, node) => {
    if (node.base === "quiz-paper-link" && node.externalNodeId) {
      links.push({
        unit: unit.id,
        unitName: unit.name ?? "",
        groupId: node.id,
        paperId: node.externalNodeId,
        title: (node.name ?? "Quiz").trim()
      });
    }
    for (const child of node.children ?? []) walk(unit, child);
  };
  for (const unit of units) for (const child of unit.children ?? []) walk(unit, child);
  return links;
}
function authHeader2(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}
function baseHeaders2(token) {
  return {
    authorization: authHeader2(token),
    lovefrom: "learner",
    accept: "application/json, text/plain, */*",
    "content-type": "application/json"
  };
}
async function createChallengeInstance(options, ids, fetcher = fetch) {
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL2}/api/reader/paper/instance/createPaperInstanceByPublishedBook`,
    { method: "POST", headers: baseHeaders2(options.token), body: JSON.stringify(ids) }
  );
  const json = await response.json();
  if (json.code !== 200 || !json.data) {
    throw new Error(`createChallengeInstance: ${json.message ?? `code ${json.code}`}`);
  }
  return json.data;
}
async function submitChallengeAnswers(options, payload, fetcher = fetch) {
  const timestamp = payload.a;
  const signature = buildSubmitSignature({
    authorization: authHeader2(options.token),
    openId: readOpenId(options.token),
    referer: options.referer,
    timestamp
  });
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL2}/api/reader/paper/answer/submitUserPaperAnswer`,
    {
      method: "POST",
      headers: {
        ...baseHeaders2(options.token),
        origin: "https://ipub.unipus.cn",
        referer: options.referer,
        "x-referer": options.referer,
        v: signature
      },
      body: JSON.stringify(payload)
    }
  );
  return await response.json();
}
async function submitChallengeScore(options, ids, fetcher = fetch) {
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL2}/api/reader/paper/answer/submitUserChallengeScore`,
    {
      method: "POST",
      headers: {
        ...baseHeaders2(options.token),
        ...options.referer ? { origin: "https://ipub.unipus.cn", referer: options.referer, "x-referer": options.referer } : {}
      },
      body: JSON.stringify(ids)
    }
  );
  return await response.json();
}

// src/vendor/speech.ts
var DEFAULT_BASE_URL3 = "https://ipub.unipus.cn";
function authHeader3(token) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}
async function fetchClioSig(options) {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL3}/api/reader/answer/getClioSig`,
    {
      method: "POST",
      headers: {
        authorization: authHeader3(options.token),
        lovefrom: "learner",
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        bizQuestionId: options.bizQuestionId,
        questionType: options.questionType ?? "oral_personal_state",
        soeQuestionType: options.soeQuestionType ?? 77
      })
    }
  );
  const json = await response.json();
  if (json.code !== 200 || !json.data) {
    throw new Error(`getClioSig failed: ${json.code} ${json.message ?? ""}`.trim());
  }
  const data = json.data;
  return {
    applicationId: String(data.applicationId),
    sig: String(data.sig),
    timestamp: Number(data.timestamp),
    userId: String(data.userId),
    tokenId: String(data.tokenId)
  };
}
async function waitForAnswerEvaluation(options) {
  const fetcher = options.fetcher ?? fetch;
  const interval = options.intervalMs ?? 1500;
  const attempts = options.maxAttempts ?? 20;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const url = `${options.baseUrl ?? DEFAULT_BASE_URL3}/api/reader/answer/getAnswerCallbackEvaluation?bizAnswerId=${encodeURIComponent(options.bizAnswerId)}`;
    try {
      const response = await fetcher(url, {
        headers: {
          authorization: authHeader3(options.token),
          lovefrom: "learner",
          accept: "application/json"
        }
      });
      const json = await response.json();
      const evaluation = json.data?.evaluation;
      if (typeof evaluation === "string" && evaluation.length > 0) {
        return evaluation;
      }
    } catch {
    }
    if (attempt < attempts - 1) {
      await new Promise((done) => setTimeout(done, interval));
    }
  }
  return null;
}
function speechScoreFromEvaluation(evaluation) {
  let json;
  try {
    json = JSON.parse(evaluation);
  } catch {
    return null;
  }
  const result = json?.finalResult?.result ?? json?.result;
  if (!result) return null;
  const extra = result.extra_details ?? {};
  const multi = extra.multi_dim_score ?? {};
  return {
    total: Number(result.total ?? 0),
    audioTime: Number(result.audio_time ?? 0),
    accuracy: Number(multi.accuracy ?? 0),
    fluency: Number(multi.fluency ?? 0),
    relevance: Number(multi.relevance ?? 0),
    transcript: String(result.asr_detail ?? ""),
    conclusion: String(extra?.multi_dim_feedback?.conclusion ?? ""),
    raw: json
  };
}
function buildOralAnswerValue(score, audioUrl, bizAnswerId) {
  return JSON.stringify({
    score: Math.round(score.total),
    smooth: Math.round(score.fluency),
    completed: 0,
    correctness: Math.round(score.accuracy),
    details: [],
    audioUrl,
    type: "EN_ASR_REC",
    bizAnswerId,
    relevance: Math.round(score.relevance),
    duration: Math.round(score.audioTime * 1e3),
    conclusion: score.conclusion,
    wordDetails: []
  });
}

// src/vendor/cos.ts
import { createHash, createHmac as createHmac3 } from "node:crypto";
var DEFAULT_BASE_URL4 = "https://ipub.unipus.cn";
function authHeader4(token) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}
async function fetchCosCredential(options) {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `${options.baseUrl ?? DEFAULT_BASE_URL4}/api/cos/answer/getCOSCredential`,
    {
      method: "GET",
      headers: {
        authorization: authHeader4(options.token),
        lovefrom: "learner",
        accept: "application/json"
      }
    }
  );
  const json = await response.json();
  if (json.code !== 200 || !json.data) {
    throw new Error(
      `COS credential failed: ${json.code} ${json.message ?? ""}`.trim()
    );
  }
  const data = json.data;
  const required = ["tmpSecretId", "tmpSecretKey", "sessionToken", "domain"];
  for (const key of required) {
    if (!data[key]) throw new Error(`COS credential missing ${key}`);
  }
  return {
    tmpSecretId: String(data.tmpSecretId),
    tmpSecretKey: String(data.tmpSecretKey),
    sessionToken: String(data.sessionToken),
    domain: String(data.domain),
    pathPrefix: String(data.pathPrefix ?? ""),
    ...data.expiration ? { expiration: String(data.expiration) } : {}
  };
}
function sha1Hex(value) {
  return createHash("sha1").update(value, "utf8").digest("hex");
}
function hmacSha1Hex(key, value) {
  return createHmac3("sha1", key).update(value, "utf8").digest("hex");
}
function cosAuthorization(input) {
  const start = input.startTime ?? Math.floor(Date.now() / 1e3) - 60;
  const end = input.endTime ?? Math.floor(Date.now() / 1e3) + 1800;
  const keyTime = `${start};${end}`;
  const signTime = keyTime;
  const headerEntries = Object.entries(input.headers).map(([name, value]) => [name.toLowerCase(), value]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const headerList = headerEntries.map(([name]) => name).join(";");
  const headerString = headerEntries.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  const httpString = [
    input.method.toLowerCase(),
    input.pathname,
    "",
    headerString,
    ""
  ].join("\n");
  const stringToSign = ["sha1", signTime, sha1Hex(httpString), ""].join("\n");
  const signKey = hmacSha1Hex(input.secretKey, keyTime);
  const signature = hmacSha1Hex(signKey, stringToSign);
  return [
    "q-sign-algorithm=sha1",
    `q-ak=${input.secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    "q-url-param-list=",
    `q-signature=${signature}`
  ].join("&");
}
async function uploadCosObject(options) {
  const fetcher = options.fetcher ?? fetch;
  const domain = options.credential.domain.replace(/\/+$/, "");
  const host = new URL(domain).host;
  const objectPath = options.objectPath.replace(/^\/+/, "");
  const pathname = `/${objectPath}`;
  const url = `${domain}/${objectPath}`;
  const authorization = cosAuthorization({
    method: "PUT",
    pathname,
    headers: { host },
    secretId: options.credential.tmpSecretId,
    secretKey: options.credential.tmpSecretKey
  });
  const response = await fetcher(url, {
    method: "PUT",
    headers: {
      authorization,
      host,
      "x-cos-security-token": options.credential.sessionToken,
      "content-type": options.contentType ?? "audio/wav"
    },
    body: options.body
  });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url,
    ...response.headers.get("etag") ? { etag: response.headers.get("etag") } : {},
    body: body.slice(0, 500)
  };
}

// src/vendor/upload.ts
var DEFAULT_READER_BASE_URL2 = "https://ipub.unipus.cn";
function findUploadSpec(rawChapter, groupId) {
  const list = Array.isArray(rawChapter.questionList) ? rawChapter.questionList : [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const group = raw;
    if (String(group.groupId ?? "") !== groupId) continue;
    const item = Array.isArray(group.list) ? group.list[0] : void 0;
    const childId = item?.children?.[0]?.childId ?? item?.childId ?? group.childId ?? null;
    if (!group.versionNumber || !childId) return null;
    return {
      groupId,
      versionNumber: String(group.versionNumber),
      childId: String(childId)
    };
  }
  return null;
}
async function uploadAnswerFile(options, file, fetcher = fetch) {
  const credential = await fetchCosCredential({
    token: options.token,
    baseUrl: options.baseUrl ?? DEFAULT_READER_BASE_URL2,
    fetcher
  });
  const objectPath = `${credential.pathPrefix.replace(/^\/+/, "")}${file.fileName}`;
  const result = await uploadCosObject({
    credential,
    objectPath,
    body: file.data,
    contentType: file.contentType,
    fetcher
  });
  if (!result.ok) {
    throw new Error(`COS upload failed: HTTP ${result.status} ${result.body}`);
  }
  return {
    url: result.url,
    fileName: file.fileName.replace(/\.[^.]+$/, ""),
    fileType: file.contentType,
    fileSize: file.data.byteLength,
    suffix: file.suffix
  };
}
function buildUploadAnswerValue(file) {
  return JSON.stringify([
    {
      list: [
        {
          fileName: file.fileName,
          fileType: file.fileType,
          fileSize: file.fileSize,
          suffix: file.suffix,
          fileUrl: file.url,
          type: "File",
          duration: null
        }
      ]
    }
  ]);
}
function buildSamplePdf(text = "Smart city design notes") {
  const content = `BT /F1 14 Tf 30 120 Td (${text.replace(/[()\\]/g, " ")}) Tj ET`;
  const body = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    `4 0 obj<</Length ${content.length}>>stream`,
    content,
    "endstream endobj",
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Size 6/Root 1 0 R>>",
    "%%EOF"
  ].join("\n");
  return new TextEncoder().encode(body);
}

// src/module.ts
var MANIFEST = JSON.parse(
  readFileSync(new URL("./courseflow.module.json", import.meta.url), "utf8")
);
var SETTINGS = (() => {
  try {
    const parsed = JSON.parse(process.env.CF_MODULE_SETTINGS || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
})();
var SOURCE = SETTINGS.source === "live" ? "live" : "fixture";
var TARGET_URL = typeof SETTINGS.target_url === "string" ? SETTINGS.target_url : "https://ucontent.unipus.cn/_ipublishpc_default/pc.html";
var COURSE_ID = typeof SETTINGS.course_id === "string" ? SETTINGS.course_id : "";
var COURSE_NAME = typeof SETTINGS.course_name === "string" && SETTINGS.course_name.trim() ? SETTINGS.course_name.trim() : "U\u6821\u56ED\u8BFE\u7A0B";
var BOOK_ID = typeof SETTINGS.book_id === "string" ? SETTINGS.book_id : "";
var BOOK_VERSION = typeof SETTINGS.book_version === "string" ? SETTINGS.book_version : "";
var IPUB_BASE = typeof SETTINGS.base_url === "string" && SETTINGS.base_url.trim() ? SETTINGS.base_url.trim() : "https://ipub.unipus.cn";
var CONTENT_BASE = typeof SETTINGS.content_base_url === "string" && SETTINGS.content_base_url.trim() ? SETTINGS.content_base_url.trim() : "https://ucontent.unipus.cn";
var SSO_BASE = "https://sso.unipus.cn";
var UCONTENT_BASE = "https://ucontent.unipus.cn";
var LOGIN_AES_KEY2 = Buffer.from("8AD70B641C024C7ADA2ECD082EC0334F", "hex");
var LOGIN_AES_IV2 = Buffer.from("0102030405060708090A0B0C0D0E0F10", "hex");
var ANNOTATOR_SECRET2 = "a824b379f126b8b7aa5e33dee83fb0a05aa7462c";
var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
var BROWSER_HEADERS = {
  "user-agent": BROWSER_UA,
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"'
};
var write = (message) => process.stdout.write(`${JSON.stringify(message)}
`);
var log = (level, message) => process.stderr.write(`[unipus] ${level} ${message}
`);
var nextId = 1;
var pending = /* @__PURE__ */ new Map();
function hostCall(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  write({ jsonrpc: "2.0", id, method, params });
  return promise;
}
function errorText(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  return String(error);
}
function encryptLoginField(value) {
  const cipher = createCipheriv2("aes-128-cbc", LOGIN_AES_KEY2, LOGIN_AES_IV2);
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("hex").toUpperCase();
}
function signAnnotatorToken2(openId, now = Date.now()) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      open_id: openId,
      name: "",
      email: "",
      administrator: false,
      exp: now + 31536e6,
      iss: "c4f772063dcfa98e9c50",
      aud: "edx.unipus.cn"
    })
  ).toString("base64url");
  const signature = createHmac4("sha256", ANNOTATOR_SECRET2).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
function buildCasService(targetUrl) {
  const withoutHash = targetUrl.split("#")[0];
  return `${UCONTENT_BASE}:443/cas-auth/login/?next=${encodeURIComponent(withoutHash)}`;
}
function decodeJwtExpiry(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? claims.exp : void 0;
  } catch {
    return void 0;
  }
}
var challenges = /* @__PURE__ */ new Map();
var challengeSeq = 0;
async function describe(params) {
  log("info", `describe framework=${params.framework_version ?? ""} source=${SOURCE}`);
  return {
    module: { name: "courseflow-unipus", version: MANIFEST.version, module_api: 1 },
    platform: MANIFEST.platform
  };
}
function placeholderQr() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><text x="80" y="78" font-size="13" text-anchor="middle" fill="#111">U\u6821\u56ED\u9AA8\u67B6</text><text x="80" y="96" font-size="11" text-anchor="middle" fill="#666">\u8BF7\u4F7F\u7528\u8D26\u53F7\u5BC6\u7801\u767B\u5F55</text></svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
function authBegin(params) {
  challengeSeq += 1;
  const id = String(params.session ?? `ch_unipus_${challengeSeq}_${Date.now()}`);
  const method = params.method === "qr" ? "qr" : "password";
  challenges.set(id, { method, state: "waiting", at: Date.now() });
  log("info", `auth.begin method=${method} challenge=${id}`);
  if (method === "qr") {
    return {
      challenge: {
        id,
        kind: "qr",
        image: placeholderQr(),
        expires_at: Math.floor(Date.now() / 1e3) + 180
      }
    };
  }
  return {
    challenge: {
      id,
      kind: "password",
      expires_at: Math.floor(Date.now() / 1e3) + 180,
      fields: [
        {
          name: "username",
          label: "U\u6821\u56ED\u8D26\u53F7",
          type: "text",
          required: true,
          autocomplete: "username",
          placeholder: "\u624B\u673A\u53F7\u6216\u90AE\u7BB1"
        },
        {
          name: "password",
          label: "\u5BC6\u7801",
          type: "password",
          required: true,
          autocomplete: "current-password"
        }
      ]
    }
  };
}
async function liveLogin(session, username, password) {
  const service = buildCasService(TARGET_URL);
  const loginPage = `${SSO_BASE}/sso/login?service=${encodeURIComponent(service)}`;
  await hostCall("cw.net.fetch", {
    session,
    method: "GET",
    url: loginPage,
    stage: "read",
    headers: {
      ...BROWSER_HEADERS,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  const loginResponse = await hostCall("cw.net.fetch", {
    session,
    method: "POST",
    url: `${SSO_BASE}/sso/0.1/sso/cip/login`,
    encoding: "json",
    stage: "read",
    headers: {
      ...BROWSER_HEADERS,
      origin: SSO_BASE,
      referer: loginPage,
      accept: "application/json, text/plain, */*"
    },
    body: {
      username: encryptLoginField(username),
      password: encryptLoginField(password),
      service,
      pcFlag: true,
      bindFlag: true,
      mfaCode: ""
    }
  });
  let login;
  try {
    login = JSON.parse(loginResponse.body);
  } catch {
    throw new Error(`SSO \u8FD4\u56DE\u975E JSON\uFF08HTTP ${loginResponse.status}\uFF09`);
  }
  if (login.code === "1506") throw new Error("\u5E73\u53F0\u8981\u6C42\u9A8C\u8BC1\u7801\uFF0C\u8BF7\u5148\u5728\u6D4F\u89C8\u5668\u5B8C\u6210\u4E00\u6B21\u767B\u5F55\u6216\u7A0D\u540E\u91CD\u8BD5");
  if (login.code !== "0") {
    throw new Error(`SSO \u767B\u5F55\u5931\u8D25\uFF1Acode ${login.code ?? "?"} ${login.msg ?? login.error ?? ""}`.trim());
  }
  const ticket = login.rs?.serviceTicket;
  const openId = login.rs?.openid;
  if (!ticket) throw new Error("SSO \u672A\u8FD4\u56DE serviceTicket");
  if (!openId) throw new Error("SSO \u672A\u8FD4\u56DE openid");
  const redeem = service.includes("?") ? `${service}&ticket=${ticket}` : `${service}?ticket=${ticket}`;
  try {
    await hostCall("cw.net.fetch", {
      session,
      method: "GET",
      url: redeem,
      stage: "read",
      headers: {
        ...BROWSER_HEADERS,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } catch (error) {
    if (error?.code !== "platform_verification_required") throw error;
    log("warn", "ticket redeem returned 403; continuing with captured cookies");
  }
  if (!COURSE_ID) {
    throw new Error("live \u6A21\u5F0F\u9700\u8981\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u63D0\u4F9B course_id\uFF08reader token \u4EA4\u6362\u7528\uFF09");
  }
  const annotator = signAnnotatorToken2(openId);
  let page;
  try {
    const opened = await hostCall("cw.browser.open", {
      session,
      url: TARGET_URL,
      purpose: "reader-token"
    });
    page = opened?.page;
    if (!page) throw new Error("\u5B98\u65B9\u6D4F\u89C8\u5668\u6CA1\u6709\u8FD4\u56DE\u9875\u9762\u53E5\u67C4");
    const expression = `(async () => {
      const res = await fetch('/course/api/v3/ipublish/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/plain, */*',
          'x-annotator-auth-token': ${JSON.stringify(annotator)}
        },
        credentials: 'include',
        body: JSON.stringify({ courseId: ${JSON.stringify(COURSE_ID)}, readerType: 2 })
      });
      const text = await res.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch {}
      return {
        href: location.href,
        status: res.status,
        code: payload?.code ?? 'non-json',
        token: payload?.data?.token ?? null,
        message: payload?.message ?? text.slice(0, 160)
      };
    })()`;
    let result = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      result = await hostCall("cw.browser.evaluate", {
        session,
        page,
        expression,
        stage: "read"
      });
      if (result && result.loading !== true) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!result || result.loading === true) {
      throw new Error("\u5B98\u65B9\u9875\u9762\u5C1A\u672A\u5C31\u7EEA\uFF0C\u65E0\u6CD5\u4EA4\u6362 reader token");
    }
    if (result.status !== 200 || !result.token) {
      throw new Error(`reader token \u6D4F\u89C8\u5668\u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${result.status} @ ${result.href ?? ""} ${result.message ?? ""}`.trim());
    }
    return {
      token: result.token,
      openId,
      expiresAt: decodeJwtExpiry(result.token),
      displayName: username
    };
  } finally {
    if (page) {
      await hostCall("cw.browser.close", { session, page }).catch(() => {
      });
    }
  }
}
async function authSubmit(params) {
  const id = String(params.challenge ?? "");
  const challenge = challenges.get(id);
  if (!challenge) return { state: "expired" };
  const fields = params.fields && typeof params.fields === "object" ? params.fields : {};
  const username = typeof fields.username === "string" ? fields.username.trim() : "";
  const password = typeof fields.password === "string" ? fields.password : "";
  if (!username || !password) {
    return { state: "failed", message: "\u8BF7\u8F93\u5165\u8D26\u53F7\u548C\u5BC6\u7801" };
  }
  log("info", `auth.submit mode=${SOURCE} challenge=${id}`);
  try {
    let identity;
    if (SOURCE === "fixture") {
      identity = {
        token: "fixture-reader-token",
        openId: "unipus-fixture",
        displayName: "U\u6821\u56ED\uFF08\u79BB\u7EBF\uFF09",
        expiresAt: void 0
      };
    } else {
      identity = await liveLogin(id, username, password);
    }
    challenge.state = "connected";
    challenge.identity = {
      display_name: identity.displayName,
      account_raw: identity.openId
    };
    challenge.token = identity.token;
    await hostCall("cw.state", {
      session: id,
      namespace: "auth",
      key: "session",
      value: {
        token: identity.token,
        open_id: identity.openId,
        expires_at: identity.expiresAt ?? null,
        source: SOURCE,
        connected_at: Date.now()
      }
    });
    log("info", `auth.submit connected source=${SOURCE}`);
    return { state: "connected" };
  } catch (error) {
    const message = errorText(error);
    challenge.state = "failed";
    challenge.message = message;
    log("warn", `auth.submit failed: ${message}`);
    return { state: "failed", message };
  }
}
function authPoll(params) {
  const challenge = challenges.get(String(params.challenge ?? ""));
  if (!challenge) return { state: "expired" };
  return { state: challenge.state };
}
function authComplete(params) {
  const id = String(params.challenge ?? "");
  const challenge = challenges.get(id);
  if (!challenge) throw { code: "invalid_params", message: "\u767B\u5F55\u6311\u6218\u4E0D\u5B58\u5728" };
  const identity = challenge.identity;
  challenges.delete(id);
  if (!identity) throw { code: "invalid_params", message: "\u767B\u5F55\u5C1A\u672A\u5B8C\u6210" };
  return identity;
}
async function authVerify(params) {
  try {
    const identity = await hostCall("cw.session.identity", { session: params.session });
    return {
      display_name: identity?.display_name ?? "U\u6821\u56ED",
      account_raw: identity?.account_raw ?? "",
      connected_at: identity?.connected_at ?? null
    };
  } catch {
    return { display_name: "U\u6821\u56ED", account_raw: "" };
  }
}
async function authKeepalive(params) {
  if (SOURCE === "fixture") return { ok: true, mode: SOURCE };
  try {
    const state = await hostCall("cw.state", {
      session: params.session,
      namespace: "auth",
      key: "session"
    });
    if (!state?.value?.token) return { ok: false, reason: "no-token" };
    return { ok: true, mode: SOURCE, expires_at: state.value.expires_at ?? null };
  } catch (error) {
    return { ok: false, reason: error.message ?? "state-unavailable" };
  }
}
var HostResponse = class {
  status;
  ok;
  body;
  headers;
  constructor(response) {
    this.status = Number(response?.status ?? 0);
    this.ok = this.status >= 200 && this.status < 300;
    this.body = typeof response?.body === "string" ? response.body : "";
    const raw = response?.headers ?? {};
    const lower = /* @__PURE__ */ new Map();
    for (const [key, value] of Object.entries(raw)) lower.set(String(key).toLowerCase(), String(value));
    this.headers = { get: (name) => lower.get(String(name).toLowerCase()) ?? null };
  }
  async text() {
    return this.body;
  }
  async json() {
    return JSON.parse(this.body);
  }
};
function hostFetchFor(session) {
  return async (input, init = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    delete headers.cookie;
    delete headers.host;
    delete headers["content-length"];
    const rawBody = init.body;
    const binaryBody = rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer;
    const body = binaryBody ? Buffer.from(
      rawBody instanceof Uint8Array ? rawBody : new Uint8Array(rawBody)
    ).toString("base64") : rawBody === void 0 || rawBody === null ? void 0 : typeof rawBody === "string" ? rawBody : String(rawBody);
    const stage = /\/api\/reader\/action\/finishNode|\/api\/reader\/answer\/submitScore|\/api\/reader\/answer\/judgeStart|\/api\/reader\/answer\/judgeResult/.test(url) ? "save_study" : "read";
    const response = await hostCall("cw.net.fetch", {
      session,
      method: String(init.method ?? "GET").toUpperCase(),
      url,
      headers,
      ...body !== void 0 ? { body, encoding: "raw" } : {},
      ...binaryBody ? { binary: true } : {},
      stage
    });
    return new HostResponse(response);
  };
}
function authHeader5(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}
function baseHeaders3(token) {
  return {
    authorization: authHeader5(token),
    lovefrom: "learner",
    accept: "application/json, text/plain, */*"
  };
}
async function readAuth(session) {
  const stored = await hostCall("cw.state", { session, namespace: "auth", key: "session" });
  const value = stored?.value;
  if (!value?.token) throw { code: "platform_login_expired", message: "\u8BF7\u5148\u8FDE\u63A5 U\u6821\u56ED" };
  return value;
}
function courseConfig() {
  if (!COURSE_ID || !BOOK_ID || !BOOK_VERSION) return null;
  return { id: COURSE_ID, name: COURSE_NAME, bookId: BOOK_ID, bookVersion: BOOK_VERSION };
}
function treeUnitNumber(treeUnit, index) {
  const digits = String(treeUnit?.id ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : index + 1;
}
function chapterForUnit(treeUnit, chapters, index) {
  const number = treeUnitNumber(treeUnit, index);
  return chapters.find((chapter) => Number(chapter?.chapterNumber) === number) ?? chapters[index] ?? null;
}
function walkGroups(unit, group, visit) {
  visit(unit, group);
  for (const child of group?.children ?? []) walkGroups(unit, child, visit);
}
function findGroup(units, groupId) {
  let found = null;
  for (const unit of units) {
    for (const child of unit?.children ?? []) {
      walkGroups(unit, child, (owner, group) => {
        if (!found && String(group?.id ?? "") === groupId) found = { unit: owner, group };
      });
    }
  }
  return found;
}
async function fetchChapterList(fetcher, token, cfg) {
  const url = `${IPUB_BASE}/api/reader/chapter/getChapterList?bookId=${encodeURIComponent(cfg.bookId)}&bookVersionNumber=${encodeURIComponent(cfg.bookVersion)}`;
  const response = await fetcher(url, { headers: baseHeaders3(token) });
  const json = await response.json();
  return Array.isArray(json?.data?.chapterList) ? json.data.chapterList : [];
}
async function fetchChapterVersion(fetcher, token, cfg, chapterId) {
  const url = `${IPUB_BASE}/api/reader/chapter/getChapterInfo?bookId=${encodeURIComponent(cfg.bookId)}&bookVersionNumber=${encodeURIComponent(cfg.bookVersion)}&chapterId=${encodeURIComponent(chapterId)}`;
  const response = await fetcher(url, { headers: baseHeaders3(token) });
  const json = await response.json();
  const data = json?.data ?? {};
  let version = data.versionNumber ? String(data.versionNumber) : void 0;
  if (!version && typeof data.content === "string") {
    const match = data.content.match(/\/([^/]+)\/studentContent\.json/);
    if (match) version = match[1];
  }
  if (!version) throw new Error(`\u65E0\u6CD5\u89E3\u6790 chapterVersionNumber\uFF08chapter ${chapterId}\uFF09`);
  return version;
}
function isVideoGroup(base) {
  return base === "insert-video";
}
function isTextGroup(base) {
  return TEXT_LEAF_BASES.includes(base);
}
function isUploadGroup(base) {
  return base === "multi_media_upload" || base === "multiFileUpload_subjective";
}
function uploadQuestionType(rawChapter, groupId) {
  const list = Array.isArray(rawChapter?.questionList) ? rawChapter.questionList : [];
  for (const raw of list) {
    const group = typeof raw === "string" ? safeJson2(raw) : raw;
    if (!group || String(group.groupId ?? "") !== groupId) continue;
    const item = Array.isArray(group.list) ? group.list[0] : void 0;
    const type = item?.questionType ?? group.groupType;
    if (type) return String(type).replace(/_group$/, "");
  }
  return "multi_media_upload";
}
function safeJson2(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
var structureCache = /* @__PURE__ */ new Map();
async function getChapterStructure(fetcher, token, cfg, chapterId) {
  const key = `${cfg.bookId}:${chapterId}`;
  const cached = structureCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1e3) return cached.value;
  const value = await fetchChapterStructure(
    { token, baseUrl: IPUB_BASE },
    { bookId: cfg.bookId, bookVersionNumber: cfg.bookVersion, chapterId },
    fetcher
  );
  structureCache.set(key, { at: Date.now(), value });
  return value;
}
async function readCachedAnswers(session, key) {
  try {
    const stored = await hostCall("cw.state", { session, namespace: "answers", key });
    const value = stored?.value;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
var AI_GRADED_TYPES = /* @__PURE__ */ new Set([
  "writing",
  "translation",
  "short_answer",
  "oral_personal_state"
]);
var OBJECTIVE_TYPES = /* @__PURE__ */ new Set([
  "single_choice",
  "multiple_choice",
  "true_false",
  "fill_blanks_choice",
  "fill_blanks",
  "text_match",
  "matching",
  "single",
  "multiple",
  "judge"
]);
function toPlainAnswer(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return value;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && "root" in parsed) {
      const text = lexicalText(parsed).trim();
      return text || value;
    }
  } catch {
  }
  return value;
}
async function readGroupState(auth, fetcher, groupId, version, questions) {
  if (!groupId || !version) {
    return {
      data: null,
      nonEmpty: 0,
      hasKey: false,
      objective: false,
      maxScore: 0,
      ungraded: false,
      complete: false
    };
  }
  const result = await withRetry(
    () => fetchChapterAnswerList(
      { token: auth.token, baseUrl: IPUB_BASE },
      groupId,
      version,
      fetcher
    ),
    3,
    700
  );
  const data = result.data ?? {};
  const children = Array.isArray(data.userAnswersResult) ? data.userAnswersResult : [];
  const nonEmpty = children.filter(
    (child) => typeof child.userAnswerValue === "string" && child.userAnswerValue.length > 0
  ).length;
  const keyed = (Array.isArray(data.correctAnswers) ? data.correctAnswers : []).filter(
    (item) => Array.isArray(item.answers) && item.answers.some(
      (answer) => typeof answer.answerValue === "string" && answer.answerValue.length > 0
    )
  );
  const types = questions.map((question) => String(question.rawType ?? question.type ?? "")).filter(Boolean);
  const objective = types.length > 0 ? types.every((type) => OBJECTIVE_TYPES.has(type)) : keyed.length > 0;
  const score = typeof data.score === "number" ? data.score : void 0;
  const maxScore = questions.reduce(
    (sum, question) => sum + (Number(question.score) || 0),
    0
  );
  const ungraded = children.length > 0 && children.every(
    (child) => (child.status ?? 0) === 0 && child.score === null
  );
  const strict = objective && !ungraded;
  const complete = strict ? score === 100 || maxScore === 0 && nonEmpty > 0 : score !== void 0 || nonEmpty > 0;
  return {
    data,
    ...score !== void 0 ? { score } : {},
    nonEmpty,
    hasKey: keyed.length > 0,
    objective,
    maxScore,
    ungraded,
    complete
  };
}
function isUngraded(state) {
  return state.ungraded;
}
function applyPlatformAnswers(submission, state) {
  const byChild = /* @__PURE__ */ new Map();
  for (const item of state.data?.correctAnswers ?? []) {
    if (!item?.childId) continue;
    const value = (item.answers ?? []).find(
      (answer) => typeof answer.answerValue === "string" && answer.answerValue
    )?.answerValue;
    if (value) byChild.set(String(item.childId), String(value));
  }
  if (byChild.size === 0) return null;
  let changed = false;
  const userAnswers = submission.userAnswers.map((record) => {
    if (AI_GRADED_TYPES.has(String(record.questionType ?? ""))) return record;
    const key = byChild.get(String(record.childId));
    if (!key) return record;
    const value = toPlainAnswer(key);
    if (value === record.userAnswerValue) return record;
    changed = true;
    return { ...record, userAnswerValue: value };
  });
  return changed ? { ...submission, userAnswers } : null;
}
async function readActivityState(session, key) {
  try {
    const stored = await hostCall("cw.state", { session, namespace: "activity", key });
    return stored?.value ?? null;
  } catch {
    return null;
  }
}
async function saveActivityState(session, key, value) {
  try {
    await hostCall("cw.state", { session, namespace: "activity", key, value });
  } catch {
  }
}
function submissionKey(submission) {
  const answers = (submission.userAnswers ?? []).map((record) => `${record.childId}${record.userAnswerValue}`).sort().join("");
  return createHash2("sha256").update(
    [
      submission.groupId,
      submission.versionNumber,
      submission.mode,
      answers
    ].join(""),
    "utf8"
  ).digest("hex");
}
var submissionLedgerCache = /* @__PURE__ */ new Map();
async function readSubmissionLedger(session, bookId) {
  const cacheKey = `${session}:${bookId}`;
  const cached = submissionLedgerCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 5e3) return cached.value;
  let value = {
    entries: {},
    blocked: {}
  };
  try {
    const stored = await hostCall("cw.state", {
      session,
      namespace: "submissions",
      key: bookId
    });
    const raw = stored?.value;
    if (raw && typeof raw === "object") {
      value = {
        entries: raw.entries && typeof raw.entries === "object" ? raw.entries : {},
        blocked: raw.blocked && typeof raw.blocked === "object" ? raw.blocked : {}
      };
    }
  } catch {
  }
  submissionLedgerCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
async function saveSubmissionLedger(session, bookId, value) {
  submissionLedgerCache.set(`${session}:${bookId}`, { at: Date.now(), value });
  try {
    await hostCall("cw.state", {
      session,
      namespace: "submissions",
      key: bookId,
      value
    });
  } catch {
  }
}
async function recordSubmission(session, bookId, entry) {
  const ledger = await readSubmissionLedger(session, bookId);
  ledger.entries[entry.key] = entry;
  await saveSubmissionLedger(session, bookId, ledger);
}
async function blockGroup(session, bookId, groupId, reason) {
  const ledger = await readSubmissionLedger(session, bookId);
  ledger.blocked[groupId] = { reason, at: Date.now() };
  await saveSubmissionLedger(session, bookId, ledger);
}
var submitThrottle = /* @__PURE__ */ new Map();
async function waitForSubmitSlot(session) {
  const now = Date.now();
  const times = (submitThrottle.get(session) ?? []).filter(
    (stamp) => now - stamp < 6e4
  );
  let wait = 0;
  if (times.length >= 20) {
    wait = Math.max(wait, 6e4 - (now - times[0]));
  }
  const last = times[times.length - 1];
  if (last !== void 0) wait = Math.max(wait, last + 2500 - now);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  times.push(Date.now());
  submitThrottle.set(session, times);
}
function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}
async function withRetry(run, attempts = 3, baseDelayMs = 800) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await run(attempt);
      const status = Number(value?.status ?? 0);
      if (isRetryableStatus(status) && attempt < attempts) {
        await new Promise(
          (resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1))
        );
        continue;
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise(
        (resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1))
      );
    }
  }
  throw lastError ?? new Error("retry failed");
}
async function solveQuestions(session, activity) {
  const payload = (activity.questions ?? []).filter((question) => !isOralQuestion(question)).map((question) => ({
    id: question.id,
    type: question.type,
    stem: question.stem,
    options: (question.options ?? []).map((option) => option.text),
    blanks: question.blankCount ?? 0,
    ...question.passage ? { passage: question.passage } : {}
  }));
  const prompt = [
    "\u4F60\u662F U\u6821\u56ED \u82F1\u8BED\u8BFE\u7A0B\u7B54\u9898\u52A9\u624B\u3002",
    '\u53EA\u8F93\u51FA JSON \u6570\u7EC4\uFF0C\u4E0D\u8981\u89E3\u91CA\u3002\u6BCF\u9879\u683C\u5F0F {"id":"\u9898\u76EEid","texts":["\u7B54\u6848"]}\u3002',
    "\u9009\u62E9\u9898 texts \u5FC5\u987B\u662F\u9009\u9879\u539F\u6587\uFF0C\u4E0D\u8981\u7528 A/B/C/D\u3002",
    "\u586B\u7A7A\u9898\u6309\u7A7A\u4F4D\u987A\u5E8F\u7ED9\u51FA\u591A\u4E2A texts\u3002",
    JSON.stringify(payload)
  ].join("\n");
  const response = await hostCall("cw.ai.generate", { session, prompt });
  const raw = String(response?.text ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  const byId = /* @__PURE__ */ new Map();
  for (const item of Array.isArray(parsed) ? parsed : []) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "");
    const texts = Array.isArray(item.texts) ? item.texts.map(String) : [];
    if (id) byId.set(id, texts);
  }
  return (activity.questions ?? []).map((question) => ({
    questionId: question.id,
    texts: byId.get(question.id) ?? [],
    confidence: 0.8,
    source: "llm"
  }));
}
var SPEECH_WS_URL = "wss://speech.unipus.cn/speech/proxy/wss";
var BAIDU_TTS_URL = "https://fanyi.baidu.com/gettts";
var TTS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
function isOralQuestion(question) {
  const type = String(question?.rawType ?? question?.type ?? "");
  return type === "oral_personal_state" || type.startsWith("oral_personal_state_");
}
function splitSpeechText(text, max = 90) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const pieces = clean.split(/(?<=[.!?;,])\s+/);
  const chunks = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const piece of pieces) {
    if (piece.length > max) {
      push();
      for (const word of piece.split(" ")) {
        if ((current + " " + word).trim().length > max && current) push();
        current = (current + " " + word).trim();
      }
      push();
      continue;
    }
    if ((current + " " + piece).trim().length > max) push();
    current = (current + " " + piece).trim();
  }
  push();
  return chunks.filter(Boolean);
}
async function synthesizeSpeech(session, text) {
  const chunks = splitSpeechText(text);
  if (chunks.length === 0) throw new Error("\u53E3\u8BED\u7B54\u6848\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u5408\u6210\u8BED\u97F3");
  const parts = [];
  for (const chunk of chunks) {
    const url = `${BAIDU_TTS_URL}?lan=en&spd=5&source=web&text=${encodeURIComponent(chunk)}`;
    const response = await hostCall("cw.net.fetch", {
      session,
      method: "GET",
      url,
      headers: { accept: "audio/mpeg,*/*", "user-agent": TTS_USER_AGENT },
      binary: true,
      stage: "read"
    });
    if (Number(response?.status) !== 200 || !response?.body) {
      throw new Error(`\u8BED\u97F3\u5408\u6210\u5931\u8D25\uFF1AHTTP ${response?.status ?? "?"}`);
    }
    parts.push(String(response.body));
  }
  return parts;
}
function transcodeExpression(parts) {
  return `(async () => {
  const parts = ${JSON.stringify(parts)};
  const b64ToBytes = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; };
  const toBase64 = (bytes) => { let binary = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); return btoa(binary); };
  const ctx = new AudioContext();
  const buffers = [];
  for (const part of parts) { const bytes = b64ToBytes(part); buffers.push(await ctx.decodeAudioData(bytes.buffer.slice(0))); }
  const gap = 0.12;
  const total = buffers.reduce((sum, buffer) => sum + buffer.duration, 0) + gap * Math.max(0, buffers.length - 1);
  const rate = 16000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(total * rate)), rate);
  let at = 0;
  for (const buffer of buffers) { const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start(at); at += buffer.duration + gap; }
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) { const s = Math.max(-1, Math.min(1, samples[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  const wav = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(wav.buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i += 1) wav[offset + i] = text.charCodeAt(i); };
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, pcm.length * 2, true); wav.set(new Uint8Array(pcm.buffer), 44);
  return { wavBase64: toBase64(wav), durationMs: Math.round(total * 1000) };
})()`;
}
function speechExpression(sig, audioBase64, transcript, reference) {
  const payload = JSON.stringify({ sig, transcript, reference });
  return `(async () => {
  const data = ${payload};
  const audio = (() => { const bin = atob(${JSON.stringify(audioBase64)}); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; })();
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; try { ws.close(); } catch {} resolve(value); };
    const timer = setTimeout(() => finish({ ok: false, error: 'SOE \u8BC4\u6D4B\u8D85\u65F6' }), 60000);
    const ws = new WebSocket(${JSON.stringify(SPEECH_WS_URL)});
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', async () => {
      try {
        ws.send(JSON.stringify({ sdk: { version: 16777216, source: 4, protocol: 'websocket' }, app: { applicationId: data.sig.applicationId, sig: data.sig.sig, timestamp: data.sig.timestamp, userId: data.sig.userId, alg: 'sha1' } }));
        ws.send(JSON.stringify({
          tokenId: data.sig.tokenId,
          audio: { audioType: 'wav', channel: 1, sampleRate: 16000, sampleBytes: 2 },
          request: {
            apiName: 'open.steam', transcript: data.transcript, userId: data.sig.userId, slack: 1,
            sig: data.sig.sig, parameters: { details: { adjust: 0 } },
            extraParam: { openQuesType: 20, openQuesRes: data.reference },
          },
        }));
        for (let offset = 0; offset < audio.length; offset += 2880) {
          if (settled) return;
          ws.send(audio.subarray(offset, Math.min(offset + 2880, audio.length)));
          await new Promise((done) => setTimeout(done, 8));
        }
        if (!settled) ws.send(JSON.stringify({ stop: true }));
      } catch (error) { clearTimeout(timer); finish({ ok: false, error: String(error && error.message || error) }); }
    });
    ws.addEventListener('message', (event) => {
      if (settled) return;
      let raw = '';
      if (typeof event.data === 'string') raw = event.data;
      else { try { raw = new TextDecoder().decode(new Uint8Array(event.data)); } catch { return; } }
      if (!raw) return;
      let json; try { json = JSON.parse(raw); } catch { return; }
      if (json.code !== 0 && json.code !== 200) { clearTimeout(timer); finish({ ok: false, error: json.message || ('SOE error ' + json.code) }); return; }
      const final = json.finalResult;
      if (!final || !final.result) return;
      const result = final.result;
      const extra = result.extra_details || {};
      const multi = extra.multi_dim_score || {};
      clearTimeout(timer);
      finish({
        ok: true,
        total: Number(result.total || 0), audioTime: Number(result.audio_time || 0),
        accuracy: Number(multi.accuracy || 0), fluency: Number(multi.fluency || 0),
        relevance: Number(multi.relevance || 0), transcript: String(result.asr_detail || ''),
        conclusion: String((extra.multi_dim_feedback || {}).conclusion || ''),
      });
    });
    ws.addEventListener('error', () => { clearTimeout(timer); finish({ ok: false, error: 'SOE \u8FDE\u63A5\u5931\u8D25' }); });
    ws.addEventListener('close', (event) => { if (!settled) { clearTimeout(timer); finish({ ok: false, error: 'SOE \u8FDE\u63A5\u5DF2\u5173\u95ED ' + event.code }); } });
  });
})()`;
}
async function oralSpokenAnswer(session, prompt) {
  const request = [
    "\u4F60\u662F\u4E00\u540D\u5927\u5B66\u751F\uFF0C\u6B63\u5728\u5B8C\u6210\u82F1\u8BED\u53E3\u8BED\u4EFB\u52A1\u3002",
    "\u53EA\u8F93\u51FA\u53EF\u4EE5\u8BF4\u51FA\u53E3\u7684\u82F1\u6587\u7B54\u6848\uFF0C30-45 \u8BCD\uFF0C\u81EA\u7136\u53E3\u8BED\uFF0C\u4E0D\u8981 Markdown\uFF0C\u4E0D\u8981\u5F15\u53F7\u3002",
    "\u5148\u7ED9\u51FA\u660E\u786E\u89C2\u70B9\uFF0C\u518D\u7ED9\u4E00\u4E2A\u5177\u4F53\u7406\u7531\u6216\u4F8B\u5B50\uFF0C\u6700\u540E\u7528\u4E00\u53E5\u7B80\u77ED\u7684\u9650\u5B9A\u6536\u5C3E\u3002",
    "",
    prompt
  ].join("\n");
  const response = await hostCall("cw.ai.generate", { session, prompt: request });
  const text = String(response?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("\u6A21\u578B\u6CA1\u6709\u751F\u6210\u53E3\u8BED\u7B54\u6848");
  return text;
}
async function openOfficialPage(session, url) {
  const opened = await hostCall("cw.browser.open", {
    session,
    url,
    stage: "read"
  });
  const page = String(opened?.page ?? "");
  if (!page) throw new Error("\u5B98\u65B9\u6D4F\u89C8\u5668\u6CA1\u6709\u8FD4\u56DE\u9875\u9762");
  return page;
}
async function evaluateOnPage(session, page, expression) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = await hostCall("cw.browser.evaluate", {
      session,
      page,
      stage: "read",
      expression
    });
    if (!(value && value.loading)) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("\u5B98\u65B9\u9875\u9762\u52A0\u8F7D\u8D85\u65F6");
}
async function runOralQuestion(session, cfg, auth, fetcher, meta, question, page) {
  const childId = String(question.childIds?.[0] ?? question.id);
  const prompt = String(question.stem ?? "").replace(/\s+/g, " ").trim();
  const spoken = await oralSpokenAnswer(session, prompt);
  const parts = await synthesizeSpeech(session, spoken);
  const transcoded = await evaluateOnPage(
    session,
    page,
    transcodeExpression(parts)
  );
  if (!transcoded?.wavBase64) throw new Error("\u8BED\u97F3\u8F6C\u7801\u5931\u8D25");
  const audio = Buffer.from(String(transcoded.wavBase64), "base64");
  const clioOptions = {
    token: auth.token,
    bizQuestionId: childId,
    baseUrl: IPUB_BASE,
    fetcher
  };
  let clio;
  try {
    clio = await fetchClioSig(clioOptions);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    clio = await fetchClioSig(clioOptions);
  }
  const evaluation = await evaluateOnPage(
    session,
    page,
    speechExpression(clio, String(transcoded.wavBase64), prompt, spoken)
  );
  if (!evaluation?.ok) throw new Error(`SOE \u8BC4\u6D4B\u5931\u8D25\uFF1A${evaluation?.error ?? "\u672A\u77E5\u9519\u8BEF"}`);
  log(
    "info",
    `soe ${childId} total=${evaluation.total} acc=${evaluation.accuracy} flu=${evaluation.fluency} rel=${evaluation.relevance}`
  );
  const uploaded = await uploadAnswerFile(
    { token: auth.token, baseUrl: IPUB_BASE },
    {
      data: new Uint8Array(audio),
      fileName: `unicheat-oral-${Date.now()}.wav`,
      contentType: "audio/wav",
      suffix: "wav"
    },
    fetcher
  );
  const callback = await waitForAnswerEvaluation({
    token: auth.token,
    bizAnswerId: clio.tokenId,
    baseUrl: IPUB_BASE,
    fetcher,
    intervalMs: 1500,
    maxAttempts: 20
  });
  const score = callback ? speechScoreFromEvaluation(callback) : null;
  if (!score) throw new Error("\u5E73\u53F0\u6CA1\u6709\u8FD4\u56DE\u53E3\u8BED\u8BC4\u6D4B\u7ED3\u679C");
  const durationMs = Number(transcoded.durationMs ?? 0);
  const value = buildOralAnswerValue(
    { ...score, audioTime: durationMs / 1e3 },
    uploaded.url,
    clio.tokenId
  );
  await waitForSubmitSlot(session);
  const response = await withRetry(
    () => submitChapterScore(
      { token: auth.token, baseUrl: IPUB_BASE },
      meta,
      {
        groupId: String(question.groupId ?? ""),
        versionNumber: String(question.groupVersion ?? ""),
        mode: "score",
        userAnswers: [
          {
            questionId: String(question.id),
            childId,
            questionType: "oral_personal_state",
            userAnswerValue: value,
            bizAnswerId: clio.tokenId
          }
        ]
      },
      fetcher
    ),
    3,
    900
  );
  log(
    "info",
    `submitScore oral ${childId} HTTP ${response.status} code ${response.json?.code ?? "?"} total=${Math.round(score.total)}`
  );
  if (!response.ok) throw new Error(`\u53E3\u8BED submitScore failed: HTTP ${response.status}`);
}
function isMatchingQuestion(question) {
  const type = String(question?.rawType ?? question?.type ?? "");
  return type === "text_match" || type === "matching";
}
function matchingEdges(question, answers) {
  const answer = answers.find(
    (item) => String(item.questionId ?? "") === String(question.id ?? "")
  );
  const pairs = Array.isArray(question.pairs) ? question.pairs : [];
  const options = Array.isArray(question.options) ? question.options : [];
  const edges = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const text = answer?.texts?.[index];
    if (!text) continue;
    const match = matchOption(String(text), options);
    const to = match?.option?.optionId ?? match?.option?.value;
    const from = pairs[index]?.id;
    if (from && to) edges.push({ from: String(from), to: String(to) });
  }
  return edges;
}
async function runMatchingFallback(session, meta, question, answers) {
  const edges = matchingEdges(question, answers);
  if (edges.length === 0) return false;
  const first = edges[0].from;
  const source = `(() => {
    const first = ${JSON.stringify(first)};
    const edges = ${JSON.stringify(edges)};
    const docs = [];
    const collect = (doc) => {
      docs.push(doc);
      for (const frame of doc.querySelectorAll('iframe')) {
        try { if (frame.contentDocument) collect(frame.contentDocument); } catch {}
      }
    };
    collect(document);
    let doc = null;
    let block = null;
    for (const candidate of docs) {
      const node = candidate.querySelector('.react-flow__node[data-id="' + first + '"]');
      if (!node) continue;
      doc = candidate;
      block = node.closest('.editor-question-block') || node.closest('[data-question-id]') || node.parentElement;
      break;
    }
    if (!block || !doc) return { ok: false, error: 'matching block not found' };
    const offset = () => {
      let x = 0;
      let y = 0;
      let win = doc.defaultView;
      while (win && win.frameElement) {
        const rect = win.frameElement.getBoundingClientRect();
        x += rect.left;
        y += rect.top;
        win = win.parent;
      }
      return { x, y };
    };
    block.scrollIntoView({ block: 'center', inline: 'center' });
    const off = offset();
    const center = (el) => {
      const rect = el.getBoundingClientRect();
      return { x: off.x + rect.left + rect.width / 2, y: off.y + rect.top + rect.height / 2 };
    };
    const out = [];
    for (const edge of edges) {
      const existing = block.querySelector('.react-flow__edge[data-testid="rf__edge-e' + edge.from + '-' + edge.to + '"]');
      if (existing) { out.push({ ...edge, skip: true }); continue; }
      const from = block.querySelector('.react-flow__node[data-id="' + edge.from + '"] .react-flow__handle.source');
      const to = block.querySelector('.react-flow__node[data-id="' + edge.to + '"] .react-flow__handle.target');
      if (!from || !to) { out.push({ ...edge, error: 'handle not found' }); continue; }
      out.push({ ...edge, from: center(from), to: center(to) });
    }
    return { ok: true, edges: out };
  })()`;
  const clickSave = `(() => {
    const docs = [];
    const collect = (doc) => {
      docs.push(doc);
      for (const frame of doc.querySelectorAll('iframe')) {
        try { if (frame.contentDocument) collect(frame.contentDocument); } catch {}
      }
    };
    collect(document);
    for (const doc of docs) {
      const button = doc.querySelector("[data-ipublish-event-type='question-submit'], .save-btn, button[data-action='save']");
      if (button) { button.click(); return { ok: true }; }
    }
    return { ok: false };
  })()`;
  const page = await openOfficialPage(session, meta.referer);
  try {
    const coords = await evaluateOnPage(session, page, source);
    if (!coords?.ok) {
      log("warn", `matching fallback: ${coords?.error ?? "block not found"}`);
      return false;
    }
    for (const edge of coords.edges ?? []) {
      if (edge.skip || edge.error || !edge.from || !edge.to) continue;
      await hostCall("cw.browser.mouse", {
        session,
        page,
        stage: "save_study",
        action: { type: "drag", from: edge.from, to: edge.to, steps: 14 }
      });
    }
    const saved = await evaluateOnPage(session, page, clickSave);
    if (!saved?.ok) log("warn", "matching fallback: save button not found");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return true;
  } catch (error) {
    log("warn", `matching fallback failed: ${errorText(error)}`);
    return false;
  } finally {
    await hostCall("cw.browser.close", { session, page }).catch(() => {
    });
  }
}
async function uploadSampleFile(fetcher, auth) {
  const fileName = `unicheat-upload-${Date.now()}.pdf`;
  return uploadAnswerFile(
    { token: auth.token, baseUrl: IPUB_BASE },
    {
      data: buildSamplePdf(),
      fileName,
      contentType: "application/pdf",
      suffix: "pdf"
    },
    fetcher
  );
}
async function studyQuestionStep(params, session, cfg, auth, fetcher, rawId) {
  const parts = rawId.split("::");
  const chapterId = parts[1] ?? "";
  const key = decodeURIComponent(parts[2] ?? "");
  const index = Number(parts[3] ?? 0);
  const structure = await getChapterStructure(fetcher, auth.token, cfg, chapterId);
  const activities = structure?.structure?.activities ?? [];
  const activity = activities.find((item) => String(item.anchor ?? item.title) === key) ?? activities[index];
  if (!activity || !Array.isArray(activity.questions) || activity.questions.length === 0) {
    throw { code: "not_found", message: "\u7AE0\u8282\u7ED3\u6784\u91CC\u627E\u4E0D\u5230\u8BE5\u9898\u76EE\u7EC4" };
  }
  log(
    "debug",
    `activity ${key} groups=${(activity.questionGroups ?? []).map((group) => `${group.groupType}:${group.groupId}`).join(",")} types=${activity.questions.map((question) => `${question.rawType}/${question.type}/${question.groupId}`).join(",")}`
  );
  const chapterVersion = structure.chapterVersionNumber ?? await fetchChapterVersion(fetcher, auth.token, cfg, chapterId);
  const meta = {
    bookId: cfg.bookId,
    bookVersionNumber: cfg.bookVersion,
    chapterId,
    chapterVersionNumber: chapterVersion,
    referer: buildChapterReferer({
      bookId: cfg.bookId,
      bookVersionNumber: cfg.bookVersion,
      chapterId
    })
  };
  const submissionLedger = await readSubmissionLedger(session, cfg.bookId);
  const groupVersionOf = (group) => String(
    group.versionNumber ?? activity.questions.find((question) => question.groupId === group.groupId)?.groupVersion ?? ""
  );
  const questionsOfGroup = (groupId) => (activity.questions ?? []).filter(
    (question) => String(question.groupId ?? "") === groupId
  );
  const groups = (activity.questionGroups ?? []).filter(
    (group) => Boolean(group?.groupId)
  );
  const allComplete = (states) => states.length > 0 && states.every((state) => state.complete);
  const saved = await readActivityState(session, rawId);
  if (saved?.completed === true && params.checkpoint?.phase !== "submitted") {
    return {
      status: "completed",
      evidence: { ...saved, cached: true },
      checkpoint: { phase: "done" }
    };
  }
  const preStates = /* @__PURE__ */ new Map();
  for (const group of groups) {
    const groupId = String(group.groupId);
    preStates.set(
      groupId,
      await readGroupState(
        auth,
        fetcher,
        groupId,
        groupVersionOf(group),
        questionsOfGroup(groupId)
      )
    );
  }
  const observedStates = new Map(preStates);
  let clearedBlocks = false;
  for (const [groupId, state] of preStates) {
    if (state.complete && submissionLedger.blocked[groupId]) {
      delete submissionLedger.blocked[groupId];
      clearedBlocks = true;
    }
  }
  if (clearedBlocks) {
    await saveSubmissionLedger(session, cfg.bookId, submissionLedger);
  }
  if (params.checkpoint?.phase !== "submitted" && allComplete([...preStates.values()])) {
    const scores = [...preStates.values()].map((state) => state.score ?? null);
    const evidence = {
      platform_confirmed: true,
      groups: preStates.size,
      scores,
      total: scores.reduce((sum, score) => sum + (score ?? 0), 0)
    };
    await saveActivityState(session, rawId, { completed: true, at: Date.now(), ...evidence });
    return { status: "completed", evidence, checkpoint: { phase: "done" } };
  }
  if (params.checkpoint?.phase !== "submitted") {
    const oralQuestions = (activity.questions ?? []).filter(isOralQuestion);
    if (oralQuestions.length > 0) {
      const done = Math.max(0, Number(params.checkpoint?.oral_index ?? 0));
      if (done < oralQuestions.length) {
        const question = oralQuestions[done];
        const already = Boolean(
          preStates.get(String(question.groupId ?? ""))?.complete
        );
        if (!already) {
          const page = await openOfficialPage(session, meta.referer);
          try {
            await runOralQuestion(session, cfg, auth, fetcher, meta, question, page);
          } finally {
            await hostCall("cw.browser.close", { session, page, stage: "read" }).catch(() => {
            });
          }
        } else {
          log("info", `oral ${String(question.id)} already answered; skipped`);
        }
        return {
          status: "in_progress",
          progress: { oral_done: done + 1, oral_total: oralQuestions.length },
          wait_ms: 500,
          checkpoint: { phase: "oral", oral_index: done + 1 }
        };
      }
    }
    const pendingGroups = groups.filter(
      (group) => !preStates.get(String(group.groupId))?.complete
    );
    if (pendingGroups.length > 0) {
      const group = pendingGroups[0];
      const groupId = String(group.groupId);
      const blocked = submissionLedger.blocked[groupId];
      if (blocked) {
        return {
          status: "needs_human",
          reason: `\u9898\u7EC4 ${groupId} \u5DF2\u6682\u505C\uFF1A${blocked.reason ?? "\u9700\u8981\u4EBA\u5DE5\u5904\u7406"}`
        };
      }
      const pendingQuestions = questionsOfGroup(groupId);
      let answers = await readCachedAnswers(session, rawId);
      if (!answers) {
        answers = await solveQuestions(session, { ...activity, questions: pendingQuestions });
        await hostCall("cw.state", {
          session,
          namespace: "answers",
          key: rawId,
          value: answers
        });
      }
      const { submissions, warnings } = buildChapterSubmissions(pendingQuestions, answers);
      if (warnings.length > 0) log("warn", `chapter warnings: ${warnings.join("; ")}`);
      if (submissions.length === 0) {
        return {
          status: "needs_human",
          reason: `\u9898\u7EC4 ${groupId} \u6CA1\u6709\u751F\u6210\u53EF\u63D0\u4EA4\u7684\u7B54\u6848\uFF0C\u9700\u8981\u4EBA\u5DE5\u68C0\u67E5`
        };
      }
      const submission = submissions[0];
      const questions = pendingQuestions;
      const key2 = submissionKey(submission);
      const previous = submissionLedger.entries[key2];
      if (previous?.pendingManual) {
        return {
          status: "needs_human",
          reason: `\u9898\u7EC4 ${groupId} \u5DF2\u63D0\u4EA4\u8FC7\u4E14\u9700\u8981\u4EBA\u5DE5\u8BC4\u5206\uFF1A${previous.reason ?? "pending manual"}`
        };
      }
      let finalSubmission = submission;
      if (submission.mode === "judge") {
        await waitForSubmitSlot(session);
        let outcome = await submitChapterJudge(
          { token: auth.token, baseUrl: IPUB_BASE },
          meta,
          submission,
          { fetcher, maxAttempts: 8, pollIntervalMs: 1200 }
        );
        if (isRetryableStatus(Number(outcome.responses.start?.status ?? 0))) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          outcome = await submitChapterJudge(
            { token: auth.token, baseUrl: IPUB_BASE },
            meta,
            submission,
            { fetcher, maxAttempts: 8, pollIntervalMs: 1200 }
          );
        }
        log(
          "info",
          `judge ${groupId} polls=${outcome.polls} score=${outcome.score ?? "pending"}` + (outcome.warnings.length > 0 ? ` warnings=${outcome.warnings.join("; ")}` : "")
        );
        if (!outcome.responses.score?.ok) {
          log("warn", `judge submitScore not ok for ${groupId}`);
        }
        observedStates.set(
          groupId,
          await readGroupState(auth, fetcher, groupId, submission.versionNumber, questions)
        );
      } else {
        await waitForSubmitSlot(session);
        const result = await withRetry(
          () => submitChapterScore(
            { token: auth.token, baseUrl: IPUB_BASE },
            meta,
            submission,
            fetcher
          ),
          3,
          900
        );
        log(
          "info",
          `submitScore ${groupId} HTTP ${result.status} code ${result.json?.code ?? "?"}`
        );
        if (!result.ok) throw new Error(`submitScore failed: HTTP ${result.status}`);
        let state = await readGroupState(
          auth,
          fetcher,
          groupId,
          submission.versionNumber,
          questions
        );
        observedStates.set(groupId, state);
        let effective = submission;
        if (state.maxScore > 0 && isUngraded(state)) {
          if (state.hasKey) {
            const corrected = applyPlatformAnswers(submission, state);
            if (corrected) effective = corrected;
          }
          finalSubmission = { ...effective, mode: "judge" };
          log("info", `escalate ${groupId}: ungraded, retrying via judgeStart`);
          const outcome = await submitChapterJudge(
            { token: auth.token, baseUrl: IPUB_BASE },
            meta,
            { ...effective, mode: "judge" },
            {
              fetcher,
              extraQuestionTypes: ["fill_blanks"],
              maxAttempts: 10,
              pollIntervalMs: 1200
            }
          );
          log(
            "info",
            `escalated ${groupId} score=${outcome.score ?? "pending"} polls=${outcome.polls}` + (outcome.warnings.length > 0 ? ` warnings=${outcome.warnings.join("; ")}` : "")
          );
          state = await readGroupState(
            auth,
            fetcher,
            groupId,
            submission.versionNumber,
            questions
          );
          observedStates.set(groupId, state);
        } else if (state.objective && state.hasKey && state.score !== 100) {
          const corrected = applyPlatformAnswers(submission, state);
          if (!corrected) {
            log("warn", `correct ${groupId}: platform key could not be applied`);
          } else {
            effective = corrected;
            finalSubmission = corrected;
            await new Promise((resolve) => setTimeout(resolve, 500));
            await waitForSubmitSlot(session);
            const correctedResult = await withRetry(
              () => submitChapterScore(
                { token: auth.token, baseUrl: IPUB_BASE },
                meta,
                corrected,
                fetcher
              ),
              3,
              900
            );
            log(
              "info",
              `correct ${groupId} score=${state.score ?? "?"} -> answer key HTTP ${correctedResult.status}`
            );
            if (correctedResult.ok) {
              state = await readGroupState(
                auth,
                fetcher,
                groupId,
                submission.versionNumber,
                questions
              );
              observedStates.set(groupId, state);
              log("info", `corrected ${groupId} score=${state.score ?? "?"}`);
            } else {
              log("warn", `correct ${groupId} failed: HTTP ${correctedResult.status}`);
            }
          }
        }
      }
      let post = observedStates.get(groupId);
      if (!post?.complete) {
        const matching = questions.filter(isMatchingQuestion);
        if (matching.length > 0 && SETTINGS.browser_fallback !== false) {
          log("info", `matching ${groupId}: protocol incomplete, trying DOM drag fallback`);
          const attempted = await runMatchingFallback(
            session,
            meta,
            matching[0],
            answers
          );
          if (attempted) {
            post = await readGroupState(
              auth,
              fetcher,
              groupId,
              submission.versionNumber,
              questions
            );
            observedStates.set(groupId, post);
            log("info", `matching fallback ${groupId} score=${post.score ?? "?"}`);
          }
        }
      }
      if (!post?.complete) {
        const reason = post?.objective ? `\u9898\u7EC4 ${groupId} \u5BA2\u89C2\u9898\u672A\u8FBE\u5230 100 \u5206\uFF08\u5F53\u524D ${post?.score ?? "\u65E0\u5206\u6570"}\uFF09` : `\u9898\u7EC4 ${groupId} \u5C1A\u672A\u5B8C\u6210\uFF08\u5E73\u53F0\u672A\u8FD4\u56DE\u6210\u7EE9\uFF09`;
        await recordSubmission(session, cfg.bookId, {
          key: submissionKey(finalSubmission),
          groupId,
          versionNumber: finalSubmission.versionNumber,
          mode: finalSubmission.mode,
          submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: 200,
          score: post?.score ?? null,
          reason,
          pendingManual: true
        });
        await blockGroup(session, cfg.bookId, groupId, reason);
        return { status: "needs_human", reason };
      }
      await recordSubmission(session, cfg.bookId, {
        key: submissionKey(finalSubmission),
        groupId,
        versionNumber: finalSubmission.versionNumber,
        mode: finalSubmission.mode,
        submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: 200,
        score: post.score ?? null,
        pendingManual: false
      });
      const doneGroups = groups.filter(
        (item) => observedStates.get(String(item.groupId))?.complete
      ).length;
      return {
        status: "in_progress",
        progress: { groups_done: doneGroups, groups_total: groups.length },
        wait_ms: 500,
        checkpoint: { phase: "groups", oral_index: oralQuestions.length }
      };
    }
  }
  const finalStates = [];
  for (const group of groups) {
    finalStates.push(
      observedStates.get(String(group.groupId)) ?? {
        data: null,
        nonEmpty: 0,
        hasKey: false,
        objective: false,
        maxScore: 0,
        ungraded: false,
        complete: false
      }
    );
  }
  if (allComplete(finalStates)) {
    const scores = finalStates.map((state) => state.score ?? null);
    const evidence = {
      platform_confirmed: true,
      groups: finalStates.length,
      scores,
      total: scores.reduce((sum, score) => sum + (score ?? 0), 0)
    };
    await saveActivityState(session, rawId, { completed: true, at: Date.now(), ...evidence });
    return { status: "completed", evidence, checkpoint: { phase: "done" } };
  }
  const low = finalStates.map((state, index2) => ({ state, group: groups[index2] })).filter(
    ({ state }) => state.objective && typeof state.score === "number" && state.score < 100
  );
  if (low.length > 0) {
    const detail = low.map(({ state, group }) => `${group.groupId}:${state.score}`).join(", ");
    log("warn", `objective groups below 100: ${detail}`);
    return {
      status: "needs_human",
      reason: `\u5BA2\u89C2\u9898\u672A\u8FBE\u5230 100 \u5206\uFF08${detail}\uFF09\uFF0C\u9700\u8981\u4EBA\u5DE5\u68C0\u67E5`
    };
  }
  const readback = Number(params.checkpoint?.readback ?? 0) + 1;
  if (readback >= 3) {
    return {
      status: "needs_human",
      reason: "\u5E73\u53F0\u5C1A\u672A\u8FD4\u56DE\u5168\u90E8\u9898\u7EC4\u7684\u5206\u6570\uFF0C\u8BF7\u5230\u5B98\u65B9\u9875\u9762\u6838\u5BF9"
    };
  }
  return {
    status: "in_progress",
    wait_ms: 2e3,
    checkpoint: { phase: "submitted", readback }
  };
}
var paperCache = /* @__PURE__ */ new Map();
function paperReferer(meta) {
  return buildChapterReferer({
    bookId: meta.bookId,
    bookVersionNumber: meta.bookVersion,
    chapterId: meta.chapterId
  });
}
async function refreshPapers(session, cfg, auth, fetcher) {
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: "", courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher
  );
  const treeLinks = collectQuizLinks(tree);
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);
  const collected = [];
  for (const link of treeLinks) {
    collected.push({ paperId: link.paperId, paperType: 0, chapterId: "", chapterName: link.unitName });
  }
  for (const chapter of chapters) {
    let structure;
    try {
      structure = await getChapterStructure(fetcher, auth.token, cfg, String(chapter.id));
    } catch (error) {
      log("warn", `paper structure ${chapter.id} failed: ${errorText(error)}`);
      continue;
    }
    const links = [];
    for (const raw of structure?.raw?.quizPaperLinks ?? []) {
      try {
        const link = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (link?.paperId) links.push(link);
      } catch {
      }
    }
    for (const activity of structure?.structure?.activities ?? []) {
      for (const link of activity.paperLinks ?? []) if (link?.paperId) links.push(link);
    }
    for (const link of links) {
      collected.push({
        paperId: String(link.paperId),
        paperType: Number(link.paperType ?? 0),
        chapterId: String(chapter.id),
        chapterName: String(chapter.name ?? "")
      });
    }
  }
  const byId = /* @__PURE__ */ new Map();
  for (const entry of collected) {
    const existing = byId.get(entry.paperId);
    if (!existing) {
      byId.set(entry.paperId, { ...entry });
      continue;
    }
    if (!existing.chapterId && entry.chapterId) {
      existing.chapterId = entry.chapterId;
      existing.chapterName = entry.chapterName;
    }
    if (!existing.paperType && entry.paperType) existing.paperType = entry.paperType;
  }
  for (const entry of byId.values()) {
    const paperId = entry.paperId;
    let paperType = entry.paperType;
    let paperName = paperId;
    let versionNumber = "";
    try {
      const response = await fetcher(
        `${IPUB_BASE}/api/reader/paper/getPaperVersionByPublishedBook`,
        {
          method: "POST",
          headers: { ...baseHeaders3(auth.token), "content-type": "application/json" },
          body: JSON.stringify({
            bookId: cfg.bookId,
            bookVersionNumber: cfg.bookVersion,
            paperId
          })
        }
      );
      const json = await response.json();
      if (json?.data) {
        paperName = String(json.data.paperName ?? paperName);
        versionNumber = String(json.data.versionNumber ?? "");
        if (!paperType && json.data.paperType) paperType = Number(json.data.paperType);
      }
    } catch (error) {
      log("warn", `paper version ${paperId} failed: ${errorText(error)}`);
    }
    if (paperType !== 2 && paperType !== 3) paperType = 2;
    paperCache.set(paperId, {
      paperId,
      paperType,
      paperName,
      versionNumber,
      chapterId: entry.chapterId,
      chapterName: entry.chapterName,
      bookId: cfg.bookId,
      bookVersion: cfg.bookVersion
    });
  }
}
async function catalogPapers(params) {
  if (SOURCE !== "live") return { papers: [] };
  const session = String(params.session ?? "");
  const cfg = courseConfig();
  if (!cfg) throw { code: "invalid_params", message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version" };
  if (params.course?.id && params.course.id !== cfg.id) return { papers: [] };
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  await refreshPapers(session, cfg, auth, fetcher);
  const metas = [...paperCache.values()];
  const statuses = /* @__PURE__ */ new Map();
  for (let index = 0; index < metas.length; index += 4) {
    const chunk = metas.slice(index, index + 4);
    const results = await Promise.all(
      chunk.map((meta) => readPaperStatus(fetcher, auth, meta).catch(() => ({ done: false, score: null })))
    );
    chunk.forEach((meta, offset) => statuses.set(meta.paperId, results[offset]));
  }
  return {
    papers: metas.map((meta) => {
      const status = statuses.get(meta.paperId) ?? { done: false, score: null };
      return {
        id: meta.paperId,
        name: meta.paperName,
        category: meta.paperType === 3 ? "unit_test" : "challenge",
        available: true,
        done: status.done,
        can_redo: true,
        can_review: true,
        score: status.score,
        attempts_left: null,
        ends_at: null
      };
    })
  };
}
function examQuestionKind(question) {
  if (question.type === "single") return "single";
  if (question.type === "multiple") return "multiple";
  if (question.type === "judge") return "judge";
  if (question.type === "matching") return (question.options?.length ?? 0) > 0 ? "multiple" : "blank";
  if (question.type === "fill") return "blank";
  return "blank";
}
function examQuestionBlanks(question) {
  if (question.type === "single" || question.type === "multiple" || question.type === "judge") {
    return 0;
  }
  return Math.max(1, Number(question.blankCount ?? 1));
}
function examQuestionText(question) {
  const body = [question.passage, question.stem].filter(Boolean).join("\n\n");
  if (question.rawType === "translation") {
    return `\u8BF7\u5B8C\u6210\u4E0B\u9762\u7684\u7FFB\u8BD1\u9898\u76EE\uFF0C\u53EA\u8F93\u51FA\u8BD1\u6587\uFF1A
${body}`;
  }
  return body;
}
function toExamAttempt(paperData) {
  return {
    id: paperData.instanceId,
    paper_id: paperData.paperId,
    name: paperData.paperName,
    expires_at: null,
    questions: (paperData.questions ?? []).map((question) => ({
      id: question.id,
      kind: examQuestionKind(question),
      text: examQuestionText(question),
      options: (question.options ?? []).map((option) => ({
        id: String(option.optionId ?? option.value ?? option.index),
        text: option.text
      })),
      answer: [],
      blanks: examQuestionBlanks(question)
    }))
  };
}
async function createUnitTestInstance(fetcher, auth, cfg, meta) {
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/instance/createPaperInstanceByPublishedBook`,
    {
      method: "POST",
      headers: { ...baseHeaders3(auth.token), "content-type": "application/json" },
      body: JSON.stringify({
        bookId: cfg.bookId,
        bookVersionNumber: cfg.bookVersion,
        paperId: meta.paperId,
        versionNumber: meta.versionNumber,
        testMode: 1
      })
    }
  );
  const json = await response.json();
  if (json.code !== 200 || !json.data) {
    throw new Error(`createPaperInstance failed: ${json.message ?? `code ${json.code}`}`);
  }
  return parsePaperData(json.data);
}
async function saveUnitTestAnswers(fetcher, auth, paperData, answers) {
  const payload = buildPaperSavePayload(paperData, answers, 1);
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/answer/saveUserPaperAnswer`,
    {
      method: "POST",
      headers: { ...baseHeaders3(auth.token), "content-type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  const json = await response.json();
  if (json.code !== 200) throw new Error(`saveUserPaperAnswer failed: ${json.message ?? `code ${json.code}`}`);
  log("info", `exam unit_test draft saved code=${json.code}`);
}
async function submitUnitTest(fetcher, auth, paperData, answers, meta) {
  const timestamp = Date.now();
  const payload = buildPaperSubmitPayload(paperData, answers, 1, timestamp);
  const referer = paperReferer(meta);
  const signature = buildSubmitSignature({
    authorization: authHeader5(auth.token),
    openId: auth.open_id,
    referer,
    timestamp
  });
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/answer/submitUserPaperAnswer`,
    {
      method: "POST",
      headers: {
        authorization: authHeader5(auth.token),
        lovefrom: "learner",
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        origin: "https://ipub.unipus.cn",
        referer,
        "x-referer": referer,
        v: signature
      },
      body: JSON.stringify(payload)
    }
  );
  const json = await response.json();
  if (json.code === 417) {
    throw {
      code: "verification_required",
      message: "\u4EA4\u5377\u88AB\u5E73\u53F0\u98CE\u63A7\uFF08417\uFF09\u3002\u8349\u7A3F\u5DF2\u4FDD\u5B58\uFF0C\u8BF7\u6253\u5F00\u5B98\u65B9 Unit Test \u9875\u9762\u624B\u52A8\u70B9\u51FB\u4EA4\u5377\u3002"
    };
  }
  if (json.code !== 200) throw new Error(`submitUserPaperAnswer failed: ${json.message ?? `code ${json.code}`}`);
  log("info", `exam unit_test submit code=${json.code}`);
}
async function readPaperScore(fetcher, auth, paperData) {
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/answer/getUserPaperScore`,
    {
      method: "POST",
      headers: { ...baseHeaders3(auth.token), "content-type": "application/json" },
      body: JSON.stringify({
        instanceId: paperData.instanceId,
        paperId: paperData.paperId,
        versionNumber: paperData.versionNumber,
        paperType: paperData.paperType,
        testMode: 1
      })
    }
  );
  const json = await response.json();
  return json?.data ?? {};
}
var paperStatusCache = /* @__PURE__ */ new Map();
function paperStatusKey(meta) {
  return `${meta.bookId}:${meta.paperId}:${meta.paperType}`;
}
async function fetchLatestPaper(fetcher, auth, meta) {
  const response = await fetcher(
    `${IPUB_BASE}/api/reader/paper/instance/getLatestPaperInstance`,
    {
      method: "POST",
      headers: { ...baseHeaders3(auth.token), "content-type": "application/json" },
      body: JSON.stringify({
        bookId: meta.bookId,
        bookVersionNumber: meta.bookVersion,
        paperId: meta.paperId,
        versionNumber: meta.versionNumber,
        paperType: meta.paperType ?? 3,
        testMode: 1
      })
    }
  );
  const json = await response.json().catch(() => null);
  return json?.code === 200 && json.data ? json.data : null;
}
async function readPaperStatus(fetcher, auth, meta) {
  const key = paperStatusKey(meta);
  const cached = paperStatusCache.get(key);
  if (cached && (cached.done || Date.now() - cached.at < 2e4)) {
    return { done: cached.done, score: cached.score };
  }
  let value = { done: false, score: null };
  try {
    const latest = await fetchLatestPaper(fetcher, auth, meta);
    if (latest?.instanceId) {
      const paperData = {
        ...parsePaperData(latest),
        paperId: meta.paperId,
        versionNumber: meta.versionNumber || latest.versionNumber,
        paperType: meta.paperType
      };
      const score = await readPaperScore(fetcher, auth, paperData);
      value = {
        done: score.status === 1,
        score: score.paperScore?.userScore ?? score.totalScore ?? null
      };
    }
  } catch (error) {
    log("warn", `paper status ${meta.paperId} failed: ${errorText(error)}`);
  }
  paperStatusCache.set(key, { ...value, at: Date.now() });
  return value;
}
async function examOpen(params) {
  const session = String(params.session ?? "");
  const cfg = courseConfig();
  if (!cfg) throw { code: "invalid_params", message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version" };
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  const paperId = String(params.paper_id ?? "");
  let meta = paperCache.get(paperId);
  if (!meta) {
    await refreshPapers(session, cfg, auth, fetcher);
    meta = paperCache.get(paperId);
  }
  if (!meta) throw { code: "not_found", message: "\u8BD5\u5377\u4E0D\u5B58\u5728" };
  const forceNew = params.force_new === true;
  const statusKey = paperStatusKey(meta);
  let paperData;
  if (!forceNew) {
    const latest = await fetchLatestPaper(fetcher, auth, meta);
    if (latest?.instanceId) {
      const candidate = {
        ...parsePaperData(latest),
        paperId: meta.paperId,
        versionNumber: meta.versionNumber || latest.versionNumber,
        paperType: meta.paperType
      };
      const score = await readPaperScore(fetcher, auth, candidate);
      if (score.status === 1) {
        paperStatusCache.set(statusKey, {
          done: true,
          score: score.paperScore?.userScore ?? score.totalScore ?? null,
          at: Date.now()
        });
        throw {
          code: "already_submitted",
          message: "\u8BE5\u8BD5\u5377\u5DF2\u4EA4\u5377\uFF1B\u5982\u9700\u91CD\u65B0\u4F5C\u7B54\uFF0C\u8BF7\u4F7F\u7528\u201C\u91CD\u505A\u201D"
        };
      }
      paperData = candidate;
      log("info", `exam resume ${meta.paperId} instance=${candidate.instanceId}`);
    }
  }
  if (forceNew) paperStatusCache.delete(statusKey);
  if (!paperData) {
    if (meta.paperType === 2) {
      const instance = await createChallengeInstance(
        { token: auth.token, baseUrl: IPUB_BASE },
        { bookId: cfg.bookId, bookVersionNumber: cfg.bookVersion, paperId: meta.paperId },
        fetcher
      );
      paperData = parsePaperData(instance);
    } else {
      paperData = await createUnitTestInstance(fetcher, auth, cfg, meta);
    }
  }
  if (!paperData.instanceId) throw new Error("\u8BD5\u5377\u5B9E\u4F8B\u7F3A\u5C11 instanceId");
  log(
    "info",
    `exam open ${paperData.paperId} ` + (paperData.questions ?? []).map((question) => `${question.rawType}:${question.type}:${question.blankCount}:${question.options?.length ?? 0}`).join(",")
  );
  await hostCall("cw.state", {
    session,
    namespace: "exam",
    key: `paper/${paperData.instanceId}`,
    value: { meta, paperData, answers: {}, phase: "opened" }
  });
  await hostCall("cw.state", {
    session,
    namespace: "exam",
    key: `latest/${paperData.paperId}`,
    value: paperData.instanceId
  });
  return { ready: true, attempt: toExamAttempt(paperData) };
}
async function examWrite(params) {
  const session = String(params.session ?? "");
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  const attemptId = String(params.attempt_id ?? "");
  const stored = await hostCall("cw.state", {
    session,
    namespace: "exam",
    key: `paper/${attemptId}`
  });
  const state = stored?.value;
  if (!state?.paperData || !state?.meta) throw { code: "not_found", message: "\u8BD5\u5377\u5B9E\u4F8B\u4E0D\u5B58\u5728" };
  const incoming = params.answers && typeof params.answers === "object" ? params.answers : {};
  const merged = { ...state.answers ?? {}, ...incoming };
  const byQuestion = new Map(
    (state.paperData.questions ?? []).map((question) => [question.id, question])
  );
  const answerList = Object.entries(merged).map(([questionId, texts]) => {
    const question = byQuestion.get(questionId);
    const values = Array.isArray(texts) ? texts.map(String) : [];
    const converted = values.map((value) => {
      const options = question?.options ?? [];
      const match = options.find(
        (option) => String(option.optionId ?? "") === value || String(option.value ?? "") === value || String(option.label ?? "") === value
      );
      return match?.text ?? value;
    });
    return {
      questionId,
      texts: converted,
      confidence: 1,
      source: "manual"
    };
  });
  const phase = params.phase === "submit" ? "submit" : "draft";
  if (state.meta.paperType === 2) {
    if (phase !== "submit") {
      await hostCall("cw.state", {
        session,
        namespace: "exam",
        key: `paper/${attemptId}`,
        value: { ...state, answers: merged, phase: "draft" }
      });
      return { done: true, cursor: null, draft_supported: false };
    }
    if (state.phase === "submitted") {
      return { done: true, cursor: null, draft_supported: false };
    }
    const timestamp = Date.now();
    const answerMap = buildPaperAnswerMap(state.paperData, answerList);
    log(
      "info",
      `exam challenge paper=${state.paperData.paperId} answers=${answerList.length} groups=${Object.keys(answerMap).length}`
    );
    const payload = {
      instanceId: state.paperData.instanceId,
      paperType: state.paperData.paperType,
      userAnswerParamsMap: answerMap,
      a: timestamp,
      b: timestamp
    };
    const answer = await submitChallengeAnswers(
      { token: auth.token, baseUrl: IPUB_BASE, referer: paperReferer(state.meta) },
      payload,
      fetcher
    );
    log(
      "info",
      `exam challenge answer code=${answer.code ?? "?"} message=${String(answer.message ?? "").slice(0, 120)}`
    );
    if (answer.code === 417) {
      throw {
        code: "verification_required",
        message: "\u4EA4\u5377\u88AB\u5E73\u53F0\u98CE\u63A7\uFF08417\uFF09\u3002\u7B54\u6848\u5DF2\u4FDD\u5B58\uFF0C\u8BF7\u6253\u5F00\u5B98\u65B9\u6311\u6218\u5377\u9875\u9762\u624B\u52A8\u70B9\u51FB\u4EA4\u5377\u3002"
      };
    }
    if (answer.code !== 0 && answer.code !== 200) {
      throw new Error(`submitUserPaperAnswer failed: ${answer.message ?? `code ${answer.code}`}`);
    }
    const score = await submitChallengeScore(
      { token: auth.token, baseUrl: IPUB_BASE, referer: paperReferer(state.meta) },
      { paperId: state.paperData.paperId, versionNumber: state.paperData.versionNumber },
      fetcher
    );
    log(
      "info",
      `exam challenge score code=${score.code ?? "?"} status=${score.data?.status ?? "?"} userScore=${score.data?.userScore ?? "?"}`
    );
    if (score.code !== 0 && score.code !== 200) {
      throw new Error(`submitUserChallengeScore failed: ${score.message ?? `code ${score.code}`}`);
    }
    await hostCall("cw.state", {
      session,
      namespace: "exam",
      key: `paper/${attemptId}`,
      value: { ...state, answers: merged, phase: "submitted" }
    });
    return { done: true, cursor: null, draft_supported: false };
  }
  if (phase === "submit") {
    await submitUnitTest(fetcher, auth, state.paperData, answerList, state.meta);
    await hostCall("cw.state", {
      session,
      namespace: "exam",
      key: `paper/${attemptId}`,
      value: { ...state, answers: merged, phase: "submitted" }
    });
    return { done: true, cursor: null, draft_supported: true };
  }
  await saveUnitTestAnswers(fetcher, auth, state.paperData, answerList);
  await hostCall("cw.state", {
    session,
    namespace: "exam",
    key: `paper/${attemptId}`,
    value: { ...state, answers: merged, phase: "draft" }
  });
  return { done: true, cursor: null, draft_supported: true };
}
async function examReadback(params) {
  const session = String(params.session ?? "");
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  const attemptId = String(params.attempt_id ?? "");
  const stored = await hostCall("cw.state", {
    session,
    namespace: "exam",
    key: `paper/${attemptId}`
  });
  const state = stored?.value;
  if (!state?.paperData) throw { code: "not_found", message: "\u8BD5\u5377\u5B9E\u4F8B\u4E0D\u5B58\u5728" };
  const score = await readPaperScore(fetcher, auth, state.paperData);
  const userScore = score.paperScore?.userScore ?? score.totalScore ?? null;
  if (score.status === 1) {
    paperStatusCache.set(paperStatusKey(state.meta), {
      done: true,
      score: userScore,
      at: Date.now()
    });
  }
  log(
    "info",
    `exam readback status=${score.status ?? "?"} score=${userScore ?? "?"}`
  );
  return {
    confirmed: score.status === 1,
    attempt_id: attemptId,
    score: userScore,
    graded_answers: [],
    review: null
  };
}
async function examReview(params) {
  const session = String(params.session ?? "");
  let attemptId = String(params.attempt_id ?? "");
  if (!attemptId && params.paper_id) {
    const latest = await hostCall("cw.state", {
      session,
      namespace: "exam",
      key: `latest/${String(params.paper_id)}`
    });
    attemptId = String(latest?.value ?? "");
  }
  if (!attemptId) return { ready: false };
  const stored = await hostCall("cw.state", {
    session,
    namespace: "exam",
    key: `paper/${attemptId}`
  });
  const state = stored?.value;
  if (!state?.paperData) return { ready: false };
  return { ready: true, attempt: toExamAttempt(state.paperData) };
}
async function catalogCourses(params) {
  const session = String(params.session ?? "");
  if (SOURCE === "live") {
    const cfg = courseConfig();
    if (!cfg) {
      throw {
        code: "invalid_params",
        message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version"
      };
    }
    await readAuth(session);
    return {
      courses: [
        {
          id: cfg.id,
          recruit_id: cfg.id,
          name: cfg.name,
          kind: "shared",
          kind_label: "\u5171\u4EAB\u8BFE",
          family: "shared",
          progress: null,
          outline_available: true
        }
      ]
    };
  }
  return {
    courses: [
      {
        id: "unipus-demo",
        recruit_id: "unipus-demo-class",
        name: "U\u6821\u56ED\uFF08\u9AA8\u67B6\u8BFE\u7A0B\uFF09",
        kind: "shared",
        kind_label: "\u5171\u4EAB\u8BFE",
        family: "shared",
        progress: 0,
        outline_available: true
      }
    ]
  };
}
async function catalogUnits(params) {
  if (SOURCE !== "live") {
    if (params.course?.id !== "unipus-demo") return { units: [] };
    return {
      units: [
        {
          id: "unipus-demo-u1",
          name: "\u7B2C 1 \u7AE0 \xB7 \u9AA8\u67B6\u5355\u5143",
          chapter_id: "unipus-demo-c1",
          chapter_name: "\u7B2C 1 \u7AE0",
          lesson_id: "unipus-demo-l1",
          kind: "video",
          duration_seconds: 60,
          watched_seconds: 0,
          state: "not_started",
          video_id: "unipus-demo-v1",
          selectable: true
        },
        {
          id: "unipus-demo-u2",
          name: "\u7B2C 1 \u7AE0 \xB7 \u9605\u8BFB\u9AA8\u67B6",
          chapter_id: "unipus-demo-c1",
          chapter_name: "\u7B2C 1 \u7AE0",
          lesson_id: "unipus-demo-l2",
          kind: "reading",
          duration_seconds: 0,
          watched_seconds: 0,
          state: "not_started",
          video_id: null,
          selectable: true
        }
      ]
    };
  }
  const session = String(params.session ?? "");
  const cfg = courseConfig();
  if (!cfg) {
    throw {
      code: "invalid_params",
      message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version"
    };
  }
  if (params.course?.id !== cfg.id) throw { code: "not_found", message: "\u8BFE\u7A0B\u4E0D\u5B58\u5728" };
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: "", courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher
  );
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);
  let durations = /* @__PURE__ */ new Map();
  try {
    durations = await fetchVideoDurations(
      {
        token: auth.token,
        baseUrl: IPUB_BASE,
        bookId: cfg.bookId,
        bookVersionNumber: cfg.bookVersion
      },
      fetcher
    );
  } catch (error) {
    log("warn", `video durations failed: ${errorText(error)}`);
  }
  const units = [];
  for (let index = 0; index < tree.length; index += 1) {
    const treeUnit = tree[index];
    const chapter = chapterForUnit(treeUnit, chapters, index);
    const chapterId = chapter?.id ? String(chapter.id) : "";
    const chapterName = String(treeUnit?.name ?? chapter?.name ?? "");
    let progress = {};
    try {
      progress = await fetchUnitProgress(
        {
          token: auth.token,
          cookie: "",
          courseId: cfg.id,
          unit: String(treeUnit.id),
          openId: auth.open_id,
          baseUrl: CONTENT_BASE
        },
        fetcher
      );
    } catch (error) {
      log("warn", `progress ${treeUnit.id} failed: ${errorText(error)}`);
    }
    for (const child of treeUnit?.children ?? []) {
      walkGroups(treeUnit, child, (owner, group) => {
        const base = String(group?.base ?? "");
        const anchor = String(group?.externalNodeId ?? "");
        if (!anchor) return;
        if (!isVideoGroup(base) && !isTextGroup(base) && !isUploadGroup(base)) return;
        const kind = isVideoGroup(base) ? "video" : isTextGroup(base) ? "reading" : "document";
        const durationMs = isVideoGroup(base) ? Number(durations.get(anchor)?.durationMs ?? 0) : 0;
        const pass = Number(progress?.[group.id]?.pass ?? 0);
        units.push({
          id: `${group.id}::${base}`,
          name: String(
            group.name ?? (kind === "video" ? "\u89C6\u9891" : kind === "reading" ? "\u9605\u8BFB" : "\u4E0A\u4F20")
          ).trim(),
          chapter_id: chapterId,
          chapter_name: chapterName,
          lesson_id: String(owner?.id ?? ""),
          kind,
          duration_seconds: durationMs > 0 ? Math.round(durationMs / 1e3) : 0,
          watched_seconds: 0,
          state: pass === 1 ? "completed" : "not_started",
          video_id: kind === "video" ? anchor : null,
          selectable: true
        });
      });
    }
    if (SETTINGS.include_questions !== false && chapterId) {
      try {
        const structure = await getChapterStructure(fetcher, auth.token, cfg, chapterId);
        const activities = structure?.structure?.activities ?? [];
        for (const [activityIndex, activity] of activities.entries()) {
          if (!activity.questions?.length) continue;
          const groupTypes = (activity.questionGroups ?? []).map((group) => String(group.groupType ?? "")).filter(Boolean);
          if (groupTypes.length > 0 && groupTypes.every((type) => /multi_media_upload/.test(type))) {
            continue;
          }
          const activityKey = activity.anchor ?? activity.title ?? `activity-${activityIndex}`;
          const id = `q::${chapterId}::${encodeURIComponent(activityKey)}::${activityIndex}`;
          const saved = await readActivityState(session, id);
          units.push({
            id,
            name: String(activity.title ?? `\u9898\u76EE ${activityIndex + 1}`).trim(),
            chapter_id: chapterId,
            chapter_name: chapterName,
            lesson_id: activity.anchor ?? "",
            kind: "document",
            duration_seconds: 0,
            watched_seconds: 0,
            state: saved?.completed === true ? "completed" : "not_started",
            video_id: null,
            selectable: true,
            selectable_note: (activity.questionGroups ?? []).map((group) => group.groupType).filter(Boolean).join(",")
          });
        }
      } catch (error) {
        log("warn", `chapter structure ${chapterId} failed: ${errorText(error)}`);
      }
    }
  }
  log("info", `catalog.units course=${cfg.id} units=${units.length}`);
  return { units };
}
async function studyStep(params) {
  if (SOURCE !== "live") {
    const unit2 = params.unit ?? {};
    const duration = Number(unit2.duration_seconds ?? 60);
    const current = Number(params.checkpoint?.seconds ?? 0);
    const next = Math.min(duration, current + 30);
    if (duration === 0 || next >= duration) {
      return {
        status: "completed",
        evidence: { watched_seconds: next, stub: true },
        checkpoint: { seconds: next }
      };
    }
    return {
      status: "in_progress",
      progress: { watched_seconds: next },
      wait_ms: 300,
      checkpoint: { seconds: next }
    };
  }
  const session = String(params.session ?? "");
  const cfg = courseConfig();
  if (!cfg) {
    throw {
      code: "invalid_params",
      message: "\u8BF7\u5728\u6A21\u5757\u8BBE\u7F6E\u91CC\u914D\u7F6E course_id / book_id / book_version"
    };
  }
  const unit = params.unit ?? {};
  const rawId = String(unit.id ?? "");
  if (rawId.startsWith("q::")) {
    const auth2 = await readAuth(session);
    const fetcher2 = hostFetchFor(session);
    return studyQuestionStep(params, session, cfg, auth2, fetcher2, rawId);
  }
  const groupId = rawId.split("::")[0];
  if (!groupId) throw { code: "invalid_params", message: "\u7F3A\u5C11\u5355\u5143 id" };
  const auth = await readAuth(session);
  const fetcher = hostFetchFor(session);
  const tree = await fetchCourseTree(
    { token: auth.token, cookie: "", courseId: cfg.id, baseUrl: CONTENT_BASE },
    fetcher
  );
  const found = findGroup(tree, groupId);
  if (!found) throw { code: "not_found", message: "\u8BFE\u7A0B\u6811\u91CC\u627E\u4E0D\u5230\u8BE5\u5355\u5143" };
  const base = String(found.group.base ?? unit.lesson_id ?? "");
  const anchor = String(found.group.externalNodeId ?? unit.video_id ?? "");
  if (!anchor) throw { code: "invalid_params", message: "\u5355\u5143\u7F3A\u5C11 anchor" };
  const index = Math.max(0, tree.indexOf(found.unit));
  const chapters = await fetchChapterList(fetcher, auth.token, cfg);
  const chapter = chapterForUnit(found.unit, chapters, index);
  if (!chapter?.id) throw { code: "not_found", message: "\u627E\u4E0D\u5230\u5BF9\u5E94\u7AE0\u8282" };
  const chapterId = String(chapter.id);
  const chapterVersion = await fetchChapterVersion(fetcher, auth.token, cfg, chapterId);
  if (params.checkpoint?.phase !== "submitted") {
    if (isVideoGroup(base)) {
      let durations = /* @__PURE__ */ new Map();
      try {
        durations = await fetchVideoDurations(
          {
            token: auth.token,
            baseUrl: IPUB_BASE,
            bookId: cfg.bookId,
            bookVersionNumber: cfg.bookVersion
          },
          fetcher
        );
      } catch (error) {
        log("warn", `video durations failed: ${errorText(error)}`);
      }
      const durationMs = Number(durations.get(anchor)?.durationMs ?? 0);
      if (!durationMs) {
        return {
          status: "unknown",
          reason: "\u65E0\u6CD5\u83B7\u53D6\u89C6\u9891\u65F6\u957F",
          checkpoint: { phase: "submitted" }
        };
      }
      const result = await markVideoWatched(
        { token: auth.token, baseUrl: IPUB_BASE },
        {
          chapterId,
          chapterVersionNumber: chapterVersion,
          bookId: cfg.bookId,
          bookVersionNumber: cfg.bookVersion,
          anchor,
          durationMs
        },
        fetcher
      );
      log(
        "info",
        `finishNode video ${anchor} HTTP ${result.status} code ${result.json?.code ?? "?"}`
      );
    } else if (isTextGroup(base)) {
      const result = await markNodeRead(
        { token: auth.token, baseUrl: IPUB_BASE },
        {
          bookId: cfg.bookId,
          bookVersionNumber: cfg.bookVersion,
          chapterId,
          chapterVersionNumber: chapterVersion,
          anchor,
          nodeType: base,
          dwellMs: 6e4
        },
        fetcher
      );
      log(
        "info",
        `finishNode text ${anchor} type ${base} HTTP ${result.status} code ${result.json?.code ?? "?"}`
      );
    } else if (isUploadGroup(base)) {
      const leafs2 = await fetchUnitProgress(
        {
          token: auth.token,
          cookie: "",
          courseId: cfg.id,
          unit: String(found.unit.id),
          openId: auth.open_id,
          baseUrl: CONTENT_BASE
        },
        fetcher
      );
      if (Number(leafs2?.[groupId]?.pass ?? 0) === 1) {
        log("info", `upload ${groupId} already completed; skipped`);
      } else {
        const structure = await getChapterStructure(fetcher, auth.token, cfg, chapterId);
        const spec = findUploadSpec(structure.raw, anchor);
        if (!spec) throw new Error(`\u7AE0\u8282\u7ED3\u6784\u91CC\u627E\u4E0D\u5230\u4E0A\u4F20\u9898\u7EC4 ${anchor}`);
        const questionType = uploadQuestionType(structure.raw, spec.groupId);
        const uploaded = await uploadSampleFile(fetcher, auth);
        await waitForSubmitSlot(session);
        const result = await withRetry(
          () => submitChapterScore(
            { token: auth.token, baseUrl: IPUB_BASE },
            {
              bookId: cfg.bookId,
              bookVersionNumber: cfg.bookVersion,
              chapterId,
              chapterVersionNumber: chapterVersion,
              referer: buildChapterReferer({
                bookId: cfg.bookId,
                bookVersionNumber: cfg.bookVersion,
                chapterId
              })
            },
            {
              groupId: spec.groupId,
              versionNumber: spec.versionNumber,
              mode: "score",
              userAnswers: [
                {
                  childId: spec.childId,
                  questionType,
                  userAnswerValue: buildUploadAnswerValue(uploaded)
                }
              ]
            },
            fetcher
          ),
          3,
          900
        );
        log(
          "info",
          `submitScore upload ${spec.groupId} type=${questionType} HTTP ${result.status} code ${result.json?.code ?? "?"}`
        );
        if (!result.ok) throw new Error(`upload submitScore failed: HTTP ${result.status}`);
      }
    } else {
      return { status: "needs_human", reason: `\u672A\u652F\u6301\u7684\u7C7B\u578B ${base}` };
    }
  }
  const leafs = await fetchUnitProgress(
    {
      token: auth.token,
      cookie: "",
      courseId: cfg.id,
      unit: String(found.unit.id),
      openId: auth.open_id,
      baseUrl: CONTENT_BASE
    },
    fetcher
  );
  const pass = Number(leafs?.[groupId]?.pass ?? 0);
  if (pass === 1) {
    return {
      status: "completed",
      evidence: { platform_confirmed: true, pass },
      checkpoint: { phase: "done" }
    };
  }
  return {
    status: "in_progress",
    wait_ms: 2e3,
    checkpoint: { phase: "submitted" }
  };
}
async function dispatch(method, params) {
  switch (method) {
    case "platform.describe":
      return describe(params);
    case "auth.begin":
      return authBegin(params);
    case "auth.submit":
      return authSubmit(params);
    case "auth.poll":
      return authPoll(params);
    case "auth.complete":
      return authComplete(params);
    case "auth.verify":
      return authVerify(params);
    case "auth.keepalive":
      return authKeepalive(params);
    case "catalog.courses":
      return catalogCourses(params);
    case "catalog.units":
      return catalogUnits(params);
    case "catalog.papers":
      return catalogPapers(params);
    case "exam.open":
      return examOpen(params);
    case "exam.write":
      return examWrite(params);
    case "exam.readback":
      return examReadback(params);
    case "exam.review":
      return examReview(params);
    case "exam.redo":
      return examOpen({ ...params, force_new: true });
    case "exam.heartbeat":
      return { ok: true };
    case "study.step":
      return studyStep(params);
    default:
      throw { code: "unsupported_operation", message: `U\u6821\u56ED\u9AA8\u67B6\u672A\u5B9E\u73B0 ${method}` };
  }
}
async function handleRequest(request) {
  try {
    const result = await dispatch(request.method, request.params ?? {});
    write({ jsonrpc: "2.0", id: request.id, result: result ?? {} });
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: error?.code ?? "module_error",
        message: error?.message ?? String(error)
      }
    });
  }
}
var lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    log("warn", "ignored non-JSON input");
    return;
  }
  if (message.id !== void 0 && (message.result !== void 0 || message.error !== void 0)) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(message.error);
    else waiter.resolve(message.result);
    return;
  }
  if (typeof message.method === "string" && message.id !== void 0) {
    void handleRequest(message);
  }
});
lines.on("close", () => {
  process.exit(0);
});
