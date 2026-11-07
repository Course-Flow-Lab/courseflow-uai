import { buildChapterReferer, finishChapterNode, type ChapterApiOptions } from "./chapter-api.js";

/**
 * Text leaves (`base-paragraph` / `list` / `collapsible-block`).
 *
 * The reader reports them with `finishNode` and a scroll-batch window: `a` is
 * when the reader opened the passage, `b` is now. A zero-length window is
 * accepted (`code:200`) but answers `data:false` and does not change the leaf
 * state, so every call here carries a real dwell.
 *
 * Verified 2026-11-07 (unit 2):
 *   u2g148 base-paragraph dwell=60s -> data:true -> pass=1
 *   u2g446 base-paragraph dwell=0   -> data:false -> pass=0
 */

const DEFAULT_READER_BASE_URL = "https://ipub.unipus.cn";

/** Group bases that complete through `finishNode` alone. */
export const TEXT_LEAF_BASES = [
  "base-paragraph",
  "list",
  "collapsible-block",
  "rich_text_read",
] as const;

export type TextLeafBase = (typeof TEXT_LEAF_BASES)[number];

export function isTextLeafBase(base: string | null | undefined): base is TextLeafBase {
  return TEXT_LEAF_BASES.includes((base ?? "") as TextLeafBase);
}

export interface MarkNodeReadOptions {
  bookId: string;
  bookVersionNumber: string;
  chapterId: string;
  chapterVersionNumber: string;
  anchor: string;
  nodeType: string;
  /** How long the passage was "open"; must be > 0 for the platform to record it. */
  dwellMs: number;
}

/** One `finishNode` call with a real reading window. */
export async function markNodeRead(
  options: ChapterApiOptions,
  node: MarkNodeReadOptions,
  fetcher: typeof fetch = fetch,
) {
  const now = Date.now();
  const dwell = Math.max(1_000, node.dwellMs);
  // 精读课文 (rich_text_read) is rendered as a question-block; the platform only
  // accepts that nodeType. Verified on unit 1 u1g108 / u1g110.
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
        chapterId: node.chapterId,
      }),
      timestamp: now - dwell,
      endTimestamp: now,
    },
    { nodeId: node.anchor, nodeType },
    fetcher,
  );
}

export { DEFAULT_READER_BASE_URL };
