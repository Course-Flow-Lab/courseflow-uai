import {
  buildChapterReferer,
  finishChapterNode,
  type ChapterApiOptions,
} from "./chapter-api.js";
import { signAnnotatorToken } from "./cas-login.js";

/**
 * Video tasks (`insert-video` groups).
 *
 * The reader exposes exactly one completion endpoint: `finishNode`. For a video
 * the payload carries a playback window (`a` -> `b`); the platform compares that
 * window with the media duration and flips the group to done. Nothing is
 * streamed and nothing waits: declaring a full-length window is enough.
 *
 * Verified 2026-11-07 against unit 2:
 *   finishNode(anchor, insert-video, a = now - duration, b = now) -> code 200
 *   group state u2g838 / u2g839 / u2g840 -> 1 within seconds.
 *
 * The completion flag does NOT live on the activity node (`u2g413`), only on the
 * `insert-video` group (`u2g838`), which is why earlier probes that watched the
 * activity status saw no change.
 */

const DEFAULT_CONTENT_BASE_URL = "https://ucontent.unipus.cn";
const DEFAULT_READER_BASE_URL = "https://ipub.unipus.cn";

export interface ContentApiOptions {
  /** Reader/SSO token (`loginWithPassword().token`). */
  token: string;
  /** SSO cookie header; course-platform endpoints reject token-only calls. */
  cookie: string;
  baseUrl?: string;
}

export interface CourseTreeGroup {
  id: string;
  role?: string;
  name?: string | null;
  base?: string | null;
  externalNodeId?: string | null;
  children?: CourseTreeGroup[];
}

export interface CourseTreeUnit {
  id: string;
  name?: string;
  children?: CourseTreeGroup[];
}

export interface CourseTree {
  units: CourseTreeUnit[];
  name?: string;
  /** The published book id (`course.externalId`). */
  externalId?: string;
  /** The published book version (`course.externalVersion`). */
  externalVersion?: string;
  version?: string;
  publishVersion?: string;
}

export interface VideoTask {
  unit: string;
  unitName: string;
  groupId: string;
  anchor: string;
  title: string;
  durationMs?: number;
  /** `true` when `course_progress` already reports the group as passed. */
  done?: boolean;
}

export interface VideoDuration {
  chapterId: string;
  durationMs: number;
  name?: string;
}

function authHeaderValue(token: string): string {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function rawToken(token: string): string {
  return token.replace(/^Bearer\s+/i, "").trim();
}

/** `GET /course/api/course/<courseId>/default` -> unit tree plus book metadata. */
export async function fetchCourseTree(
  options: ContentApiOptions & { courseId: string },
  fetcher: typeof fetch = fetch,
): Promise<CourseTree> {
  const base = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const response = await fetcher(
    `${base}/course/api/course/${options.courseId}/default`,
    {
      headers: {
        cookie: options.cookie,
        authorization: rawToken(options.token),
        accept: "application/json",
      },
    },
  );
  const text = await response.text();
  const json = JSON.parse(text) as {
    code?: number;
    course?: string;
    msg?: string;
    version?: number | string;
    publish_version?: number | string;
  };
  if (json.course) {
    const parsed = JSON.parse(json.course) as
      | CourseTreeUnit[]
      | {
          units?: CourseTreeUnit[];
          name?: string;
          externalId?: string;
          externalVersion?: string;
          version?: string | number;
        };
    const course = Array.isArray(parsed) ? { units: parsed } : parsed;
    const units = Array.isArray(course.units) ? course.units : [];
    const version = course.version ?? json.publish_version ?? json.version;
    return {
      units,
      ...(course.name ? { name: String(course.name) } : {}),
      ...(course.externalId !== undefined && course.externalId !== null
        ? { externalId: String(course.externalId) }
        : {}),
      ...(course.externalVersion !== undefined && course.externalVersion !== null
        ? { externalVersion: String(course.externalVersion) }
        : {}),
      ...(version !== undefined ? { version: String(version) } : {}),
      ...(json.publish_version !== undefined
        ? { publishVersion: String(json.publish_version) }
        : {}),
    };
  }
  throw new Error(`fetchCourseTree: ${json.msg ?? `code ${json.code}`}`);
}

/** Every `insert-video` group in the course tree. */
export function collectVideoGroups(units: CourseTreeUnit[]): VideoTask[] {
  const tasks: VideoTask[] = [];
  const walk = (unit: CourseTreeUnit, node: CourseTreeGroup) => {
    if (node.base === "insert-video" && node.externalNodeId) {
      tasks.push({
        unit: unit.id,
        unitName: unit.name ?? "",
        groupId: node.id,
        anchor: node.externalNodeId,
        title: (node.name ?? "视频").trim(),
      });
    }
    for (const child of node.children ?? []) walk(unit, child);
  };
  for (const unit of units) {
    for (const child of unit.children ?? []) walk(unit, child);
  }
  return tasks;
}

/**
 * `GET /course/api/v2/course_progress/<courseId>/<unit>/<openId>/default`.
 *
 * The trailing `/default` segment is mandatory; without it the endpoint answers
 * `code:2 No User` even with a valid cookie and token.
 */
export async function fetchUnitProgress(
  options: ContentApiOptions & {
    courseId: string;
    unit: string;
    openId: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<Record<string, { pass?: number; pass2?: number }>> {
  const base = options.baseUrl ?? DEFAULT_CONTENT_BASE_URL;
  const response = await fetcher(
    `${base}/course/api/v2/course_progress/${options.courseId}/${options.unit}` +
      `/${options.openId}/default`,
    {
      headers: {
        cookie: options.cookie,
        authorization: rawToken(options.token),
        "x-annotator-auth-token": signAnnotatorToken(options.openId),
        accept: "application/json",
      },
    },
  );
  const json = (await response.json()) as {
    code?: number;
    rt?: { leafs?: Record<string, { state?: { pass?: number; pass2?: number } }> };
    msg?: string;
  };
  if (!json.rt) throw new Error(`fetchUnitProgress: ${json.msg ?? `code ${json.code}`}`);
  const leafs: Record<string, { pass?: number; pass2?: number }> = {};
  for (const [id, leaf] of Object.entries(json.rt.leafs ?? {})) {
    leafs[id] = {
      ...(leaf.state?.pass !== undefined ? { pass: leaf.state.pass } : {}),
      ...(leaf.state?.pass2 !== undefined ? { pass2: leaf.state.pass2 } : {}),
    };
  }
  return leafs;
}

/** Media durations from `getBookResource`, keyed by video anchor. */
export async function fetchVideoDurations(
  options: {
    token: string;
    baseUrl?: string;
    bookId: string;
    bookVersionNumber: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<Map<string, VideoDuration>> {
  const base = options.baseUrl ?? DEFAULT_READER_BASE_URL;
  const response = await fetcher(
    `${base}/api/reader/chapter/getBookResource` +
      `?bookId=${encodeURIComponent(options.bookId)}` +
      `&bookVersionNumber=${encodeURIComponent(options.bookVersionNumber)}`,
    {
      headers: {
        authorization: authHeaderValue(options.token),
        lovefrom: "learner",
        accept: "application/json",
      },
    },
  );
  const json = (await response.json()) as {
    code?: number;
    data?: { resourceList?: Array<{ chapterId?: string; resource?: string }> };
    message?: string;
  };
  if (!json.data?.resourceList) {
    throw new Error(`fetchVideoDurations: ${json.message ?? `code ${json.code}`}`);
  }

  const durations = new Map<string, VideoDuration>();
  for (const entry of json.data.resourceList) {
    const chapterId = entry.chapterId;
    if (!chapterId || !entry.resource) continue;
    let parsed: { resources?: unknown[] };
    try {
      parsed = JSON.parse(entry.resource) as { resources?: unknown[] };
    } catch {
      continue;
    }
    for (const item of parsed.resources ?? []) {
      const resource =
        typeof item === "string"
          ? (safeJson(item) as Record<string, any> | undefined)
          : (item as Record<string, any>);
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
        ...(resource.mediaFile?.mediaName
          ? { name: String(resource.mediaFile.mediaName) }
          : {}),
      });
    }
  }
  return durations;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface MarkVideoOptions {
  chapterId: string;
  chapterVersionNumber: string;
  bookId: string;
  bookVersionNumber: string;
  anchor: string;
  durationMs: number;
  /** Optional padding so the reported window is never shorter than the media. */
  extraMs?: number;
}

/**
 * Declare a full playback window for one video node.
 *
 * `finishNode` answers `data:true` for any window, but only a window at least as
 * long as the media flips the group to done.
 */
export async function markVideoWatched(
  options: ChapterApiOptions,
  video: MarkVideoOptions,
  fetcher: typeof fetch = fetch,
) {
  const now = Date.now();
  const dwell = video.durationMs + (video.extraMs ?? 1000);
  const referer = buildChapterReferer({
    bookId: video.bookId,
    bookVersionNumber: video.bookVersionNumber,
    chapterId: video.chapterId,
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
      endTimestamp: now,
    },
    { nodeId: video.anchor, nodeType: "insert-video" },
    fetcher,
  );
}
