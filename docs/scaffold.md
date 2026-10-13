# 脚手架

本仓由 `create-dsh-plugin` 0.2.3 的 panel 模板生成。宿主半是 `src/index.ts`（`tsc` 到 `dist/`）。浏览器半是 `lib/client.js`，由 module loader 按 `exports["./client"]` 发现。`cordis.patch.yml` 只插入宿主行，`name` 是包名 `dsh-refs2zotero`。

模板的浏览器半注册的是 `settings.section`。产品页面改为 better-sidebar 的「参考文献」之后，`package.json` 里 `dsh.client.inject` 是 `betterSidebar`。侧边栏插件装在 profile 里，不写进本包的 dependencies。写成 peer 会让安装器去拉整棵客户端依赖。

## 坑

1. 浏览器半必须用 `window.__ModuleLoader__.load({ factory: (require) => ... })`，用 `require` 取 React 和客户端包，不要写裸 ESM import。
2. `exports["./client"]` 必须指向浏览器半文件。
3. 宿主路由用 `res.writeHead` 和 `res.end`。
4. Node 版本是 `^22.19.0 || >=24.0.0`。
5. `@deepseek-ai/dsh-tools` 的 `latest` 是过期的 `0.0.1-rc.1`。正确版本在 `next`。本模板生成时锁的是 `0.2.0-rc.2`。panel 模板运行时不依赖 `dsh-tools`，不要为了对齐去装 `latest`。
6. `@deepseek-ai/cordis` 是 peerDependency。源码里只做类型导入。
7. `package.json` 保持 `"type": "module"`。`tsc` 使用 `module: esnext` 与 `moduleResolution: bundler`。
8. `dsh plugin add <dir>` 的相对路径从调用目录算起。
9. 注册放在 `ctx.effect` 里。加载顺序靠 `inject`，不靠文件顺序。
10. 颜色走 `--dsw-alias-*`。语义属性用 `data-dsh-plugin`、`data-dsh-part`、`data-dsh-surface`。
