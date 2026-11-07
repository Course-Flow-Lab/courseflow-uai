# Courseflow U校园模块（骨架）

这是 `courseflow-unipus` 的模块骨架。**真实 CAS 账号密码登录已经打通**（含浏览器内 reader token 交换）；课程目录、章节/视频/阅读/考试等业务协议仍为骨架。

## 当前实现

| 方法 | 状态 |
|---|---|
| `platform.describe` | ✅ 与清单一致 |
| `auth.begin` / `auth.poll` / `auth.complete` | ✅ 账号密码登录（`password`） |
| `auth.submit` | ✅ fixture 直接通过；live 走真实 CAS |
| `auth.verify` / `auth.keepalive` | ✅ 基础实现 |
| `catalog.courses` | ⚠️ fixture 桩课程；live 返回已登录课程占位 |
| `catalog.units` | ⚠️ fixture 桩单元；live 为空 |
| `study.step` | ⚠️ fixture 模拟完成；live 返回 `needs_human` |
| `exam.*` / `activity.step` | ❌ 未实现 |

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
  "course_id": "<reader token 交换用的 courseId>",
  "target_url": "https://ucontent.unipus.cn/_ipublishpc_default/pc.html"
}
```

`target_url` 可省略，默认使用上面的地址。`course_id` 缺失时登录会返回明确的失败信息。

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

## 已知限制

- `live` 的 CAS 登录已实测通过：`code 0`、`serviceTicket`、`openid`、`jwt`，随后在官方页面里成功换到 reader token。
- **直接**用 Node / `cw.net.fetch` 请求 token 接口会返回 403（openresty）。live 模式已改为 `cw.browser`，不再走这条路径。
- `study.step` 在 `live` 模式返回 `needs_human`，避免在未验证业务协议的情况下伪造完成。

## 下一步

1. 把 unicheat 的 `discover` / `chapter` / `video` / `reading` 迁移为 `catalog.*` / `study.step`。
2. 题库、检查点改存 `cw.state`；删除文件系统与代理依赖。
3. 口语 WebSocket 暂不接入，先返回 `needs_human`。
