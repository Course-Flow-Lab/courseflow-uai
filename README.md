# courseflow-uai

Courseflow 的 U校园（Unipus）平台模块，提供课程目录、学习任务、章节题目、多媒体上传、口语和试卷的协议实现。

项目名是 `courseflow-uai`，模块 ID 仍然是 `unipus`；在 Courseflow 里看到的平台名称是「U校园」。

> 请只在你有权访问的账号和课程上使用。运行前确认符合平台条款和学校规定。

## 功能

- CAS 账号密码登录，reader token 通过官方页面交换
- 课程树、单元进度回读
- 视频和阅读节点完成
- 章节题目：单选、多选、判断、填空、连线，以及 AI 评分的主观题
- 多媒体上传：COS 凭证、文件上传、`submitScore`
- 口语任务：TTS、SOE 评测、音频上传、回读平台评测
- 挑战卷和 Unit Test：创建实例、草稿、交卷、分数回读
- 客观题答案回填：低于 100 分时用平台答案重交
- 提交护栏：答案去重、请求限速、408/429/5xx 重试

## 环境

- Node.js 24 或更高
- Courseflow Framework `>=0.1.1 <0.2.0`
- Chrome / Chromium，用于 live 登录、口语和连线题兜底

## 安装

```bash
git clone https://github.com/Course-Flow-Lab/courseflow-uai.git
cd courseflow-uai
npm install
npm run build
```

把模块加入 Courseflow：

```bash
cd ../courseflow-framework
npm run cli -- module add /path/to/courseflow-uai
npm run cli -- module list
```

启动服务：

```bash
npm run serve
```

## 配置

在 Courseflow 的模块设置里使用 `live` 模式：

```json
{
  "source": "live",
  "course_id": "<courseId>",
  "course_name": "U校园课程",
  "book_id": "<bookId>",
  "book_version": "<bookVersionNumber>",
  "target_url": "https://ucontent.unipus.cn/_ipublishpc_default/pc.html"
}
```

`course_id` 用于 reader token 交换，`book_id` 和 `book_version` 用于课程树与章节接口。

可选配置：

- `base_url`：默认 `https://ipub.unipus.cn`
- `content_base_url`：默认 `https://ucontent.unipus.cn`
- `browser_fallback`：设为 `false` 可关闭连线题浏览器兜底

宿主环境变量：

```bash
CF_CHROMIUM=/path/to/chrome
CF_HTTP_PROXY=http://127.0.0.1:7890
```

代理是全局的，模块请求和官方 Chromium 都会使用它。

## 使用

1. 在 Courseflow 里连接 `unipus`，输入账号密码。
2. 在「模型与任务设置」里选择一个模型。章节题和考试需要模型，未配置时任务会暂停。
3. 在「学习目录」里选择单元执行学习任务。
4. 在「作业与考试」里选择挑战卷或 Unit Test。
5. 口语任务需要本机 Chromium；每个 step 处理一题，避免超过 30 秒调用上限。

## 工作方式

模块运行在 Courseflow 的模块宿主里，通过 JSON-RPC 调用宿主提供的能力：

- `cw.net.fetch`：访问 U校园接口，处理 Cookie、授权和网络白名单
- `cw.browser`：打开官方页面，交换 reader token、建立 SOE WebSocket、拖拽 React Flow 连线
- `cw.ai.generate`：章节题和口语答案生成
- `cw.state`：保存 token、答案缓存、提交 ledger 和活动状态
- `cw.log`：写入宿主日志

登录时先通过 CAS 获取 `jwt` Cookie，再在官方页面里请求 reader token。之后的课程、章节、答案和试卷接口都走 `cw.net.fetch`。

## 项目结构

```text
src/module.ts            模块入口和方法实现
src/vendor/              从协议实现中拆出的接口代码
courseflow.module.json   模块清单
index.mjs                esbuild 打包产物
```

## 构建

```bash
npm install
npm run build
```

`index.mjs` 由 `src/module.ts` 打包生成，不要直接修改。

## 测试情况

开发时在真实课程上验证过以下流程：

- CAS 登录、课程树、视频和阅读完成
- 章节单选、填空、判断和主观题评分
- 多媒体上传：COS PUT 200，`submitScore` 200
- 挑战卷：5 题，平台确认 100 分
- Unit Test 1：26 题，自动交卷，回读 92.3 分
- 口语：SOE 评测 81 分，音频上传和提交成功

这些是开发环境的样本结果，不同课程、试卷和模型可能得到不同分数。

## 行为说明

- 自动评分的客观题必须达到 100 分才算通过。低于 100 时会读取平台答案并重交一次；仍达不到会暂停并提示人工检查。
- 平台只存储、不评分的长文本填空题（`status: 0`、`score: null`）按已作答处理，避免永远卡在 0 分。
- 主观题只要平台已保存答案就算通过，不强制 100 分。
- Unit Test 会续答未完成的实例；挑战卷始终新建实例。
- 已满分的题组会跳过，不重复调用模型，也不重复提交。
- 某个题组确认无法自动达到 100 分时会写入 `blocked`，后续任务直接暂停，不会反复重交。
- 北京时间 23:00–07:00 框架会暂停写操作。本地测试可以设置 `CF_QUIET_HOURS_DISABLED_UNTIL` 临时关闭。

## 已知限制

- 讨论题尚未作答，平台返回 0 分时可能被当作已完成。
- 连线题以协议编码为主。协议未完成时会尝试在官方页面拖拽 React Flow，失败后转人工；这条兜底路径还没有在未完成的连线上完整验证。
- 当前 8 个 Unit Test 没有 matching 题型。如果以后出现，matching 的试卷编码还没有验证。
- 上传默认生成一个示例 PDF，还没有“指定真实作业文件”的模块设置。
- 口语 TTS 使用 `fanyi.baidu.com/gettts`，答案文本会发送到百度语音接口；需要完全离线时需替换 TTS 源。
- 未实现 token 自动续期、共享答案库、逐题考试复盘和口语低分重试。
- 代理只有全局配置，没有按账号设置。
- Unit Test 或挑战卷交卷遇到 417 风控时，需要到官方页面手动点击交卷。

## 安全与隐私

- 账号密码只用于登录交换，不写入模块状态。
- reader token 和 openId 保存在模块的 `cw.state` 中。
- 仓库不包含账号、Cookie、token 或课程 ID。
- 口语 TTS 会把生成的答案文本发送到百度语音接口，不会发送账号信息。

## 贡献

欢迎提交 issue 和 pull request。提交前请先运行：

```bash
npm run build
```

## License

MIT
