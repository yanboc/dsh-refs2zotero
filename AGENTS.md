# HANDOFF

### 这里是什么

DeepSeek Harness 插件。把当前会话里读到的文献写入本机 Zotero 的一个已有分类。浏览器侧边栏页面叫「参考文献」。

包形来自 `create-dsh-plugin` 的 panel 模板：宿主半在 `src/index.ts`，浏览器半在 `lib/client.js`。浏览器半注册侧边栏「参考文献」。

### 去哪找资源

- 主张与安装见 [README.md](README.md)。
- 收集条件、写入顺序、测试清单见 [docs/behavior.md](docs/behavior.md)。
- 脚手架留下的坑见 [docs/scaffold.md](docs/scaffold.md)。
- 行为以 [docs/behavior.md](docs/behavior.md) 为准。
- 行为规格在 `openspec/specs/`（`collect`、`metadata`、`write`、`sidebar`、`library`），仅本机，不入库。

### 改动后如何维护

- 常用命令：`pnpm install`，`pnpm run build`，`pnpm run typecheck`。测试用 `pnpm test`（先打浏览器包，再 `node --test`），不接 harness 的覆盖率门。
- 热重载：desktop profile 的 `cordis.patch.yml` 已把本仓列为 HMR 模块根（`dsh-base` 默认 `root: []`）。改完 `pnpm run build`，harness 会重新 import 模块并再跑一次 `apply`，通常立刻生效，不必重开应用。**如果改了没反应，先看 `apply` 是不是抛了**：一抛整个插件就挂不上，`/dsh-refs2zotero/api` 会变成 404/405，而旧实例可能还在服务。最坑的一种是服务访问——`ctx.tools`、`ctx.llm`、`ctx.sessions` 这种**属性访问**要求写进 `inject`，没写会抛 `cannot get property "x" without inject`；用 `ctx.get('x')` 才安全（缺失返回 undefined）。诊断办法：模块加载与 `apply` 各写一行日志到 `/tmp`（宿主进程的 stdout 读不到）。客户端半另走 `dsh-client-hmr`：它轮询 `lib/client.js` 并用 SSE 推给浏览器，所以前端改动不用刷新。
- host 半的真实形状：`tool/result` 的消息字段是 `toolCallId`（`source.callId` 同值），没有 `callId`；`session.id` 是会话 id；事件形如 `{ type, seq, time, data }`。harness 源码可从 `@deepseek-ai/*` 包名下的 `lib/typert.host.js` 里读到内嵌的 TS 声明。
- 宿主半能拿到 `ctx.get('llm')`（`stream(options)`，接受普通 `{role, content, source}` 消息对象）和 `ctx.get('tools')`（`register(definition)`，JSON Schema 只支持 type/oneOf/properties/required/additionalProperties/items/enum/const + 注解，`minimum` 之类会抛）。插件不必 import harness 包。
- harness 自己读不了 PDF（`web_fetch` 拒绝 `application/pdf`，`read` 拒绝二进制）。插件用 Mozilla 的 `pdfjs-dist` 自己注册了 `read_pdf` 工具；依赖装在包内，宿主半按需动态 import。
- 查重要 Zotero 的本地 API（设置 → 高级 → 允许其他应用与本机 Zotero 通信），默认关闭时返回 403；关闭时按 warning 降级、照常写入。查重必须带 `qmode=everything`，否则 DOI 查不中。
- 客户端半的样式：只用 `--dsw-alias-*` / `--dsw-font-*` 设计令牌，尺寸照 better-sidebar 的 changes 页（头部带 36px、控件 28px、chip 22px、圆角 ≤4px）。原子组件与样式表在 `src/ui.js`（注入一张 `<style>`，class 前缀 `zr-`）。条目是**两行**：题名一行、元信息一行。归档集合要**同步**读盘（`src/archived.js`），因为 `list` 时按会话判断归档状态、重放是同步的。
- 消息正文的收集只收「链接形式」的标识（`arxiv.org/abs|pdf/…`、`arXiv:<id>`、`doi.org/…`），匹配前先剥掉代码块/行内代码；裸 `10.xxxx/…` 和任意裸 URL 都不收（压缩摘要是条 user 消息、会把整段历史重放出来，宽匹配会灌垃圾）。
- 纯文本 `read` 的收集要有防线：先剥掉 `read` 的 `<path>/<content>` 信封，只把文件**开头 12 行**当记录找字段标签，标识只在开头 2000 字里找。否则代理读自己的源码/测试文件（里面写着 `title:`、DOI 之类的 fixture）会被当成文献，甚至合并进真正的那一行、把它的 DOI 覆盖掉。
- 列表只在插件实例内存里，所以挂载时会用 `ctx.get('sessions').list()` 的每个会话日志重放收集（`src/replay.js` + `seedSession`）。改动收集条件后，这条重放路径与实时路径共用代码，不要另写一套解析。
- 测试先行：新行为先写会失败的 `node --test`，再改实现。现有断言不改弱。
- 规格：已有行为的修复与测试加固直接改。新行为或行为变更先建 `openspec/changes/<name>/`（proposal、design、tasks、spec delta），做完后 `openspec archive` 回 `openspec/specs/`。改了行为就同步 `docs/behavior.md`、对应测试和 spec。提交前跑 `openspec validate --all --strict`。
- 公开文档只用用户 / 助手。
- 浏览器半不要请求 Zotero 端口。宿主半才调用 connector。
- 不做 GitHub Pages，直到侧边栏有可公开的演示。
- 没有明确要求时不要 `git init`，不要 push。
