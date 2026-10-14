<div align="center">

# dsh-refs2zotero

</div>

用 DSH 读到的文献，写进本机 Zotero。

侧边栏有一页「参考文献」。这一会话里实际读到的文献列在这里：带 DOI / arXiv 或摘要的页面、插件自己的 `read_pdf` 工具读过的 PDF、带 `.pdf` 路径的 `read`。用户点选后，写入自己选中的已有分类。

题录能从 DOI 或 arXiv 解析到，就用那条规范记录（列表里直接显示规范题名、作者、期刊卷期页）。解析不到时，插件会把读到的正文交给会话所用的模型，让它给出一份题录——**建议先显示在侧边栏，只有用户点了「采用」才会用于写入**；不点就只用已经读到的字段。

写入时宿主会把 PDF 一并存进 Zotero：`read_pdf` 下载的缓存文件或本地 `.pdf` 直接读，否则自己去找（`pdfUrl`、arXiv id、页面里的 PDF 链接）并下载；手里有网页时再留一份单文件快照。已在库的仍留在列表里，标记为已在库，不再建第二条。笔记、新建分类，都不做。

## 读 PDF

harness 自带的 `web_fetch` 不支持 `application/pdf`，`read` 也拒绝二进制。插件因此注册了一个 `read_pdf` 工具（宿主半，用 Mozilla 的 pdf.js）：`read_pdf { url }` 会把 PDF 下载到临时目录并返回正文，`read_pdf { path }` 直接读本地文件。它读过的 PDF 同时会进「参考文献」列表，写入 Zotero 时直接用那个缓存文件。

查重靠 Zotero 的本地 API。它默认是关的：关着的时候插件跳过查重、照常写入，并在结果里提醒可能新建重复条目。要让它查重，在 Zotero 里打开 设置 → 高级 → 允许其他应用与本机 Zotero 通信。

## 开始用

桌面端 Zotero 开着，profile 里装有 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) v0.4.0 及以上。三种安装方式任选：

```sh
# 1) 从 npm（推荐：装的是预构建产物，无需构建授权）
dsh plugin --profile <name> add dsh-refs2zotero

# 2) 从 GitHub（安装时用 prepare 脚本现场构建，首次会要求授权该构建）
dsh plugin --profile <name> add github:yanboc/dsh-refs2zotero

# 3) 本地目录（开发用；路径按 clone 下来的目录名写，在它上一级执行）
pnpm install && pnpm run build
dsh plugin --profile <name> add ./dsh-refs2zotero
```

装好后打开 Web，侧边栏出现「参考文献」。

维护入口见 [AGENTS.md](AGENTS.md)。收集条件、写入顺序和测试见 [docs/behavior.md](docs/behavior.md)。变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

[MIT](LICENSE)
