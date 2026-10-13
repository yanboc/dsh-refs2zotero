# 收集与写入

侧边栏列出当前会话收集到的文献。用户可以点选、全选、搜索、预览题录，从已有分类里选一个，再一键写入。

列表每行显示题名、作者（只显示第一作者加「等」）、年份、有没有 PDF、是否已在库。预览显示题名、作者、年份、标识、摘要、期刊卷期页、链接、有没有 PDF、是否已在库，以及题录有没有按规范记录补全。选定的分类在当前会话记住，下次打开仍可改。

「写入 Zotero」要在**既勾选了文献、又选定了已有分类**之后才亮。灰着的时候旁边会写出原因（先勾选 / 再选分类 / 读不到分类 / 正在写入）——没有原因说明的灰按钮等于坏按钮。列表与分类每 2 秒轮询一次；轮询失败时保留上一次的列表与分类，只更新提示文字，不能把用户正在操作的下拉框清掉。

## 收集

听 `session/event`。`tool/call` 记下 `callId`、工具名、参数；`tool/result` 按**同一次调用的身份**取回文本。身份取消息的 `toolCallId`，回退 `callId`，再回退 `source.callId`——当前 harness 的 `ToolResultMessage` 只有 `toolCallId` 与 `source.callId`，没有 `callId`，只读 `callId` 会一行也收不到。会话 id 是 `session.id`。`session/disposed` 时丢掉该会话的列表。

**列表从会话日志重建**：列表只在插件实例的内存里，插件一重挂（重载、重装、重新挂载）就会空。所以挂载时遍历会话服务里的每个会话，用它自己的事件日志重放一遍配对与收集；`session/created` 时同样处理新会话。重放是幂等的，走同一套条件（失败调用和普通网页照样不收），有标识的行逐个补规范记录，但不触发模型补题录——挂载时不该替用户花一串模型调用。这样「只要 session 还在，这个 session 读过的文献就一直在」。

收进行里的条件：这次调用成功，并且要么是 PDF（URL 或本地路径），要么正文里有 DOI，或有 Abstract / 摘要。普通网页不收。同一 DOI、URL 或路径合并成一行，有 PDF 的信息盖过只有链接的信息。合并题名时，真正的标题胜过 URL、文件名和裸标识符。

真实页面是 markdown 之后：

- DOI 常出现在链接里，形如 `[https://doi.org/10.48550/arXiv.1810.04805](https://doi.org/10.48550/arXiv.1810.04805)`。解析要停在 `]`，否则会吞掉后面的链接语法。
- 真正题名常标成 `# Title:…`；`# Computer Science > Computation and Language` 这种是面包屑，`[PLOS One](/plosone/.)` 这种是纯链接，都不能当题名。
- 摘要前面常隔着 `## Abstract` / `### Background`，取正文要跳过标题行。

`web_fetch` 的参数里有 `url`。结果正文在 `message.content` 的 text 块里。

harness 自己的两条路读不了 PDF（`web_fetch` 遇到 `application/pdf` 报 `WEB_UNSUPPORTED_CONTENT_TYPE`，`read` 以 `FS_NOT_TEXT` 拒绝二进制），所以插件**自己注册了一个 `read_pdf` 工具**（宿主半，用 Mozilla 的 pdf.js）：给 `url` 就下载到临时目录再抽文字，给 `path` 就直接读。结果第一行固定是 `PDF <来源> -> <本地缓存路径>`，收集时靠这一行拿到本地文件，写入时不必再下载一次。扫描件抽不出文字时工具报错，不进列表。

**什么形式都收**：带标识或摘要的页面、`read_pdf` 读过的 PDF、带 `.pdf` 路径的 `read`。普通文本文件要有标识，或至少两个学术标签（`Title:`、`Authors:`、`Journal:`、`Volume:` …）才算，免得随手读的笔记混进来；纯网页仍然不收。

## 题录补全

收集到带 DOI 或 arXiv 标识的行之后，宿主半在后台向 doi.org / arXiv 取规范记录，存到这一行的 `resolved` 上。侧边栏用 `resolved` 优先显示题名、作者、年份、摘要、期刊、卷期页，并标出「题录已按规范记录补全」。

- 尽力而为：查不到就保留收集阶段读到的字段，不丢行、不编造。
- 同一标识不并发重复查询，一行只查一次。
- 收集字段原样保留在行上，便于排查「当时到底读到了什么」。
- 写入时直接复用 `resolved`，不重复查询；附件 `X-Metadata.title` 与父条目最终题名一致。

## 没有标识时让模型补题录

没有标识、但有正文的行（典型是 `read_pdf` 读来的 PDF），宿主半把正文前 6000 字交给会话所用的模型，要它回一个 JSON 题录。它会写进这一行的 `proposed`，**在用户确认之前绝不参与写入**：

- 侧边栏把建议显示成「模型建议的题录（还没采用）」，带「采用 / 忽略」。
- 「采用」把 `proposed` 并进 `resolved`，条目才用上模型的字段；「忽略」丢掉。
- 也可以手动点「让模型补题录」。
- 模型没给出可用 JSON、调用超时或宿主没有模型服务时，这一行保持原样并给出提示；不得编造字段。`parseRecord` 只接受能对上形状的字段（四位年份、真 DOI/arXiv 形状、http(s) URL）。

## 页面

`ctx.betterSidebar` 只在浏览器侧。注册放在 `ctx.effect` 里。页 id 用 `dsh-refs2zotero:library`，标题「参考文献」，`order` 60，`single: true`。不要和内置的 `explorer` / `git` / `subagent` / `terminal` / `browser` / `editor` / `diff` 重复。

浏览器只 `fetch` 本插件在 DSH web 服务器上的路由，例如 `/dsh-refs2zotero/api`。宿主用 `ctx.webServer.register` 挂 exact 路由，`inject` 含 `webServer`。这个插件只给 Web profile。

## 写入

基址是桌面端 Zotero 的 connector 端口。请求带 `X-Zotero-Connector-API-Version: 3`。以 Zotero 源码 `server_connector.js` 和 `saveSession.js` 为准。

一批选中的行用一个新的 `sessionID`：

1. `GET /connector/ping`。失败就告诉页面 Zotero 没开。
2. 按 DOI 查重：`GET /api/users/0/items?q=<doi>&qmode=everything`。对得上的跳过。查重失败记进失败结果，不要静默丢掉。**`qmode=everything` 不能省**：Zotero 默认的 `q` 只搜题名、作者与年份，实测不带这个参数时任何 DOI 都查不中，于是每次写入都会新建重复条目。
3. 题录：DOI 用 `https://doi.org/{doi}`，`Accept: application/vnd.citationstyles.csl+json`。映射 `itemType`、`title`、`creators`、`date`、`DOI`、`url`、`abstractNote`、`publicationTitle`、`volume`、`issue`、`pages`。arXiv 用 arXiv API。条目 `id` 用这一行的稳定 id。
4. `POST /connector/saveItems`，body 含 `sessionID` 和 `items`。
5. `POST /connector/updateSession`，body 含 `sessionID` 和 `target`（分类树 id，形如 `C1`）。不要传 `note`。
6. 有 PDF 时 `POST /connector/saveAttachment`。`X-Metadata` 里是 `sessionID`、`parentItemID`、`title`、`url`；正文是文件字节。本地路径（`read_pdf` 的缓存文件、`read` 到的 `.pdf`）直接读；没有本地文件时宿主自己找 PDF：`pdfUrl`、arXiv id（含 `10.48550/arXiv.…` 形式的 DOI）、页面里 `citation_pdf_url` 或 `.pdf` 链接。只下载 http(s)，不要下载回环地址。限制 20MB 并校验 `%PDF-`。手里有 HTML 时，用 connector 的单文件快照接口留下网页。

分类列表来自 `POST /connector/getSelectedCollection` 的 `targets`。只展示已有项。

`/connector/savePage` 已删除。不要把 URL 交给 Zotero 自己去打开。

### 查重依赖 Zotero 本地 API

`GET /api/users/0/items` 属于 Zotero 的本地 API，默认是关的。关闭时它整站返回 403 `Local API is not enabled`——这是能力缺失，不是这一行有问题：

- 该行**照常写入**，结果里带一条 `warnings`：说明这次跳过了查重、可能新建重复条目，以及去哪里打开（Zotero 设置 → 高级）。
- 其它查重错误（例如 500）仍然记入 `failed` 并跳过该行。

要在 Zotero 里打开：设置 → 高级 → 允许其他应用与本机 Zotero 通信。

## 测试

用 `node --test`。至少覆盖：

- 成功的 `web_fetch`：带 DOI 或摘要的网页收进列表；普通网页不收；失败调用不收。
- 真实 harness 的 `tool/result` 形状（`toolCallId` + `source.callId`）能配上对。
- 同一标识合并，PDF 信息保留，文件名/标识符不盖掉真标题。
- markdown 链接里的 DOI、面包屑标题、`## Abstract` 之后的正文。
- `read_pdf`：结果头解析出本地缓存文件，带/不带标识都进列表；学术文本文件收、随手笔记不收。
- PDF 模块：按页抽文字、只接受真 `%PDF-` 字节、拒绝回环下载、缓存到本地并复用（注入假 pdf.js，测试不联网）。
- CSL JSON 映射成 Zotero 条目字段；缺字段不编造。
- 规范记录补全：成功折进 `resolved`，失败保持原样，同一标识并发只查一次。
- 模型补题录：提示词带上已读到的线索；模型输出夹在散文/代码块里也能解析；形状不对就拒绝而不是猜；宿主没有模型服务时明确报错。确认前 `resolved` 不变，采用后才生效，忽略则丢掉。
- 假服务器上：查重命中则不调用 `saveItems`；写入时依次出现 `saveItems`、`updateSession`（带 `target`、不带 `note`）、有 PDF 时的 `saveAttachment`；403 查重降级为 warning 且照常写入；没有 `pdfUrl` 时能从 arXiv id 或网页链接找到 PDF。
- 端到端（`tests/e2e.test.js`）：真 socket 的插件路由 + 真 socket 的假 connector，只有 doi.org 是替身，跑通「会话事件 → 列表 → 写入 → 附件」，以及「`read_pdf` → 模型建议 → 用户采用 → 用缓存文件挂附件」。
- 会话日志重放：跨会话重建列表、没有会话服务时容错、重复重放不产生重复行、有标识的行逐个补规范记录。
- 列表的搜索、点选、全选、预览，用纯函数测。
- 打出来的 client 脚本里没有 Zotero 端口号，也没有 pdf.js 和 `read_pdf`（读 PDF 是宿主半的事）。

断言在 `tests/`，用 `pnpm test` 跑。现有断言不改弱。

## 后续

- 听 `user/message` 的 `file` 块，让用户手动附加的 PDF 也能直接进列表。
- 侧边栏的「导出」按钮：对还没有 PDF 的行，让模型去找可下载的 PDF 再交给宿主导入。
