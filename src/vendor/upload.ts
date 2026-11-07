import { type ChapterApiOptions } from "./chapter-api.js";
import { fetchCosCredential, uploadCosObject } from "./cos.js";
import type { CourseTreeGroup, CourseTreeUnit } from "./video.js";

/**
 * File upload tasks (`multi_media_upload_group`).
 *
 * The platform does not score these (`score: 0`), but the leaf still needs a
 * submission. Captured flow (2026-11-07, unit 1):
 *
 *   1. GET  /api/cos/answer/getCOSCredential   -> temp creds + pathPrefix
 *   2. PUT  <cos domain>/<pathPrefix><file>    -> public fileUrl
 *   3. POST /api/reader/answer/submitScore {
 *        groupId,
 *        userAnswers: [{ childId, questionType: "multi_media_upload",
 *                        userAnswerValue: JSON.stringify([{ list: [{ fileName, fileType,
 *                          fileSize, suffix, fileUrl, type: "File", duration: null }] }]) }]
 *      }
 */

const DEFAULT_READER_BASE_URL = "https://ipub.unipus.cn";

export interface UploadLeaf {
  unit: string;
  unitName: string;
  /** Course-tree group id, used for `course_progress` lookups. */
  id: string;
  /** Platform question-group id (`<childId>==<groupId>`), used for submitScore. */
  groupId: string;
  title: string;
  done?: boolean;
}

export function collectUploadLeaves(units: CourseTreeUnit[]): UploadLeaf[] {
  const rows: UploadLeaf[] = [];
  const walk = (unit: CourseTreeUnit, node: CourseTreeGroup) => {
    if (node.base === "multi_media_upload" || node.base === "multiFileUpload_subjective") {
      if (node.externalNodeId) {
        rows.push({
          unit: unit.id,
          unitName: unit.name ?? "",
          id: node.id,
          groupId: node.externalNodeId,
          title: (node.name ?? "Upload").trim(),
        });
      }
    }
    for (const child of node.children ?? []) walk(unit, child);
  };
  for (const unit of units) for (const child of unit.children ?? []) walk(unit, child);
  return rows;
}

export interface UploadGroupSpec {
  groupId: string;
  versionNumber: string;
  childId: string;
}

/** Pull versionNumber + childId for one upload group out of `getChapterInfo.data`. */
export function findUploadSpec(
  rawChapter: { questionList?: unknown },
  groupId: string,
): UploadGroupSpec | null {
  const list = Array.isArray(rawChapter.questionList) ? rawChapter.questionList : [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const group = raw as Record<string, any>;
    if (String(group.groupId ?? "") !== groupId) continue;
    const item = Array.isArray(group.list) ? group.list[0] : undefined;
    const childId =
      item?.children?.[0]?.childId ?? item?.childId ?? group.childId ?? null;
    if (!group.versionNumber || !childId) return null;
    return {
      groupId,
      versionNumber: String(group.versionNumber),
      childId: String(childId),
    };
  }
  return null;
}

export interface UploadFileInput {
  data: Uint8Array;
  fileName: string;
  contentType: string;
  suffix: string;
}

export interface UploadedFile {
  url: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  suffix: string;
}

/** Upload bytes to the answer bucket and return the metadata the reader sends. */
export async function uploadAnswerFile(
  options: ChapterApiOptions,
  file: UploadFileInput,
  fetcher: typeof fetch = fetch,
): Promise<UploadedFile> {
  const credential = await fetchCosCredential({
    token: options.token,
    baseUrl: options.baseUrl ?? DEFAULT_READER_BASE_URL,
    fetcher,
  });
  const objectPath = `${credential.pathPrefix.replace(/^\/+/, "")}${file.fileName}`;
  const result = await uploadCosObject({
    credential,
    objectPath,
    body: file.data,
    contentType: file.contentType,
    fetcher,
  });
  if (!result.ok) {
    throw new Error(`COS upload failed: HTTP ${result.status} ${result.body}`);
  }
  return {
    url: result.url,
    fileName: file.fileName.replace(/\.[^.]+$/, ""),
    fileType: file.contentType,
    fileSize: file.data.byteLength,
    suffix: file.suffix,
  };
}

/** Exact `userAnswerValue` shape stored by the reader. */
export function buildUploadAnswerValue(file: UploadedFile): string {
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
          duration: null,
        },
      ],
    },
  ]);
}

/** A tiny valid PDF, used when the caller has no material of their own. */
export function buildSamplePdf(text = "Smart city design notes"): Uint8Array {
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
    "%%EOF",
  ].join("\n");
  return new TextEncoder().encode(body);
}
