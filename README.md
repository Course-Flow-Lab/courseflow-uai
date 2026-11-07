# Courseflow U校园模块（骨架）

这是 `courseflow-unipus` 的模块骨架。**真实 CAS 账号密码登录已经打通**（含浏览器内 reader token 交换）；课程目录、章节/视频/阅读/考试等业务协议仍为骨架。

## 当前实现

| 方法 | 状态 |
|---|---|
| `platform.describe` | ✅ 与清单一致 |
| `auth.begin` / `auth.submit` / `auth.poll` / `auth.complete` | ✅ 真实 CAS 账号密码登录 |
| `auth.verify` / `auth.keepalive` | ✅ 基础实现 |
| `catalog.courses` | ✅ 配置课程（`course_id` / `course_name`） |
| `catalog.units` | ✅ 真实课程树：视频 / 阅读 / 题目活动，带进度回读 |
| `study.step` | ✅ 视频/阅读 `finishNode`；客观题 `submitScore`；主观题 `judgeStart`/`judgeResult`/`submitScore` |
| `catalog.papers` | ✅ 8 个挑战卷 + 8 个 Unit Test（从课程树/章节结构提取） |
| `exam.*` | ✅ 挑战卷 create → 提交 → 分数确认；Unit Test create / 草稿 / 交卷 / 回读 |

## 登录模式

模块设置（`CF_MODULE_SETTINGS`）里的 `source`：

| 值 | 行为 |
|---|---|
| `fixture`（默认） | 任意账号密码都直接 `connected`，用于离线验证框架 |
| `live` | 真实 CAS 登录 + 浏览器内 reader token 交换 |

`live` 需要额外的模块设置：

```json
{
  "source": "live",
  "course_id": "<reader token / course 用的 courseId>",
  "course_name": "U校园课程",
  "book_id": "<教材 bookId>",
  "book_version": "<bookVersionNumber>",
  "target_url": "https://ucontent.unipus.cn/_ipublishpc_default/pc.html",
  "base_url": "https://ipub.unipus.cn",
  "content_base_url": "https://ucontent.unipus.cn"
}
```

`course_id` 用于登录时的 reader token 交换；`book_id` + `book_version` 用于课程树和章节接口。`course_name` 可省略。

`live` 的课程/单元来自 U校园 课程树：`catalog.units` 会列出 `insert-video` 和 `base-paragraph` / `list` / `collapsible-block` / `rich_text_read` 叶子；`study.step` 用 `finishNode` 完成并回读 `course_progress`。

真实 CAS + token 流程：

```text
GET  sso.unipus.cn/sso/login?service=...
POST sso.unipus.cn/sso/0.1/sso/cip/login   (AES-128-CBC)
GET  ucontent.unipus.cn:443/cas-auth/login/?next=...   (Set-Cookie: jwt)

cw.browser.open(TARGET)                    ← 宿主把 CAS Cookie 注入官方页面
cw.browser.evaluate(fetch('/course/api/v3/ipublish/token',
  { credentials: 'include', body: { courseId, readerType: 2 } }))
  → 200 + data.token
```

> 直接用 Node / `cw.net.fetch` 请求 token 接口会被 openresty 返回 403（请求指纹被 WAF 拦），
> 所以 live 模式改用 `cw.browser` 在官方页面里请求。需要清单 `browser: true` 和宿主的 `CF_CHROMIUM`。

凭据只用于登录交换，不写入 `cw.state`。reader token 和 openId 存在 `cw.state` 的 `auth/session`。

## 宿主服务冒烟

`catalog.courses` 会依次验证：

1. `cw.net.fetch` 访问 `https://sso.unipus.cn/sso/login?...`（白名单内）
2. `cw.net.fetch` 访问 `https://example.com/`（应返回 `net_blocked`）
3. `cw.state` 写入并读回一条记录
4. `cw.session.identity` 读取身份

结果写入 stderr 日志，并通过 `cw.log` 通知宿主。

## 清单

- `id` / `platform.id`：`unipus`
- `runtime.engine`：`node`，入口 `index.mjs`
- `login`：`password`（网页显示账号密码表单）
- `operations`：`study`、`trial`
- `unit_kinds`：`video`、`reading`、`document`
- 网络许可：`unipus.cn`、`*.unipus.cn`、`*.myqcloud.com`
- `browser`：`true`（live reader token）
- `ai`：`false`

## 安装

先准备框架（Node ≥ 24），然后：

```bash
cd courseflow-framework
npm run cli -- module add /path/to/courseflow-unipus
npm run cli -- module list
```

启动服务后，在网页「平台连接」里连接 `unipus`，输入 U校园 账号密码。
live 模式需要宿主设置 `CF_CHROMIUM` 指向 Chrome/Chromium 可执行文件。

## 验证

可以复用 `cf-demo.sh` 的 API 流程，把平台 id 从 `sim` 换成 `unipus`，课程 id 用 `unipus-demo` / `unipus-demo-class`，单元 id 用 `unipus-demo-u1`。

重点看：

- 服务端 stderr 的 `[unipus]` 日志
- `cw.net.fetch allowed status=200`
- `cw.net.fetch blocked as expected: net_blocked`
- `cw.state round-trip-ok`
- `cw.session.identity account_raw=unipus-skeleton`

## 构建

```bash
npm install
npm run build   # esbuild → index.mjs
```

`index.mjs` 是打包后的模块入口；源码在 `src/module.ts`，unicheat 的协议代码在 `src/vendor/`。

## 已知限制

- `live` 的 CAS 登录、浏览器内 reader token、课程树、视频完成已实测通过。
- 挑战卷已实测：5 题 → `submitUserPaperAnswer` → `submitUserChallengeScore` → `userScore=5`，平台确认 100 分。
- Unit Test 已实测全自动交卷：Unit test 1（26 题，单选 + 填空 + 翻译）→ 草稿 200 → 交卷 200 → 回读 status 1，**92.3 分**。
- Unit Test 会把阅读材料拼进题干；翻译题会附加“只输出译文”的指令；框架侧同时支持选项文本 / 选项 id / A-B-C-D 和判断题同义词。
- Unit Test 1–8 题型完全一致：**21 × single_choice + 4 × fill_blanks_choice + 1 × translation**，共 26 题。
- 8 个 Unit Test 中**没有 matching、writing、short_answer、discussion、upload、speaking** 等特殊题型。
- `matching`（`text_match` / 连线）只出现在章节活动里，Unit Test 里没有；当前模块的章节题目链路已能处理 `text_match` 的选项编码。
- **章节题目和考试都需要先在 Courseflow「模型与任务设置」中选择一个模型**；未配置时任务会暂停并提示。
- 上传、口语、讨论尚未实现。
- 北京时间 23:00–07:00 框架会暂停写操作；本地测试可临时设置 `CF_QUIET_HOURS_DISABLED_UNTIL`。

## 下一步

1. 继续覆盖其他 Unit Test 的 matching / 特殊题型。
2. 上传、口语、讨论。
3. 口语优先走 `cw.browser` 或返回 `needs_human`。
