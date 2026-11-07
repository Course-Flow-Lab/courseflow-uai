# courseflow-uai

Courseflow 的 U校园（Unipus）平台模块，提供课程目录、学习任务、章节题目、多媒体上传、口语和试卷的协议实现。


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

## 贡献

欢迎提交 issue 和 pull request。

## License

MIT
