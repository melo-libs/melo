# Melo Lite 功能落地计划（骨架占位）

_Last updated: 2026-06-05_

> 这份是**还原之后**的功能阶段计划，目前只占位、不实现。
> 视觉还原见 [restoration-plan.md](./restoration-plan.md)，原则与数据模型见 [architecture.md](./architecture.md)。
>
> 还原阶段把整套 UI 用 sample 数据铺好了；功能阶段的活就是**把 mock 换成真实现**，
> UI 尽量原样复用。每个阶段落地前再单独拆成带勾选项的细单。

## 排序逻辑

按依赖从地基往上：先打通文件系统和索引（一切真实数据的来源），
再接 CODE 主线（Collect → Organize → Distill → Express），最后是接收端、设置、AI。

数据流始终走架构定的三段 pipeline：**抓取 → 存入（文件是 truth，索引是 cache）→ 展示**。

---

## F0 — Filesystem Layer + IPC 打通

**产出**：真实 workspace 的读写与变化监听；sidebar 文件树从磁盘来，不再是 `SAMPLE_TREE`。

- workspace 选择 / 打开 / 记住上次
- 目录扫描 → 文件树（含 `.assets` / `.melo` 隐藏规则）
- 文件读写、重命名、移动、删除走真实 fs，复用还原期的 `treeOps` 交互语义
- fs.watch 监听外部改动，回灌 UI

**依赖**：无（地基）。
**待定**：watch 防抖与冲突合并策略；大 workspace 首次扫描的增量/懒加载。

## F1 — Index Layer（SQLite）

**产出**：`.melo/index.db`，架构里的 `files / tags / fields / fts / links` 五表；文件→索引单向同步。

- 文件落盘即更新索引；启动时对账（mtime/hash）
- 关键不变量：索引任何时候能从 `.md` 100% 重建
- FTS5 全文 + frontmatter 字段抽取

**依赖**：F0。
**待定**：索引重建触发时机；hash 选型与增量更新粒度。

## F2 — capture pipeline（Collect 接真）★ 主线第一条

**产出**：架构说"从 v1 就要存在"的统一 `capture` 函数；CollectCard 的 `fakeFetch` 换成真抓取。

- `capture(url)`：主进程 fetch → 抽正文（Readability 类）→ 标题/字数/摘要
- 落盘：写 `.md` + frontmatter（source、created）；正文里的图下到 `.assets/YYYY/MM/uuid.ext`
- 默认进 Inbox；同步进索引
- 所有入口（app 快捷键、扩展、未来 agent）都调这一个函数，客户端只是 adapter

**依赖**：F0、F1。
**待定**：抽正文库选型；抓取失败/反爬的降级（存裸 HTML？只存链接？）；摘要是否接 AI（先占位）。

## F3 — Organize 接真

**产出**：文件树、tags、Smart Views、workspace 全部接真实数据。

- 文件树增删改移 → 真实 fs（衔接 F0）
- Tags：只读写 frontmatter，扁平；tag 聚合来自索引
- Smart Views：按架构的 query schema（tags/folder/日期/text）跑真实查询，存 `.melo/views.json`
- Workspace 切换：单 workspace 在线，列表存全局 `config.json`

**依赖**：F0、F1。**设计待补**：Smart Views 的 UI（还原阶段 Phase 11 占位）。

## F4 — Distill 接真

**产出**：编辑器存盘、双链、Backlinks、搜索全部可用。

- 编辑器：打开真实 `.md`、自动保存（防抖）、ProseMirror ↔ Markdown 落盘
  - 索引联动预案：实时字数等热数据由编辑器内存自算,不走"落盘→索引→查询"一圈;
    若大文件重索引有感,把 watcher 对 change 事件的 debounce 单独拉长(停笔再索引)
- 双链 `[[note]]`：补全、跳转、创建占位笔记；只到笔记级（架构决策）
- Backlinks 面板：读 `links` 表
- 搜索：FTS5 全文 + 字段，结果作为一种 tab

**依赖**：F1（links/fts）、F0（存盘）。**设计待补**：Backlinks 面板 UI（Phase 11 占位）。

## F5 — Express 接真

**产出**：导出、卡片分享、全局发布落地。两条分享互不冲突：

- Export：HTML / PDF / 图片（衔接还原期 Phase 9 的 ShareCard）
- 局部分享（选区 → 图片卡）：已在还原期做出，选中文字从 bubble menu 触发
- 全局发布（整篇 / 目录 / 工作区对外）：顶栏 Share… 的真身，把文档或 workspace 发成服务 /
  静态站 / 链接。还原期是 `comingSoon` 占位；这里接后端。见架构待定"HTTP 发布服务"

**依赖**：F4（拿到渲染好的文档）；全局发布另需 F6 一类的后端能力。

## F6 — Collect 接收端

**产出**：架构定的"菜单栏常驻 + 本地 HTTP server"，让浏览器扩展能把页面推进来。

- 本地 HTTP server 接 `capture`（复用 F2，不另起逻辑）
- 浏览器扩展配对（密钥存全局 `config.json`）
- 菜单栏常驻入口

**依赖**：F2（capture 必须先稳）。**待定**：HTTP server 端口/鉴权；扩展本身是否纳入本仓库。

## F7 — Settings 持久化

**产出**：还原期的 Settings UI（Phase 10）接真实读写。

- workspace 级 `.melo/settings.json`；应用全局 `~/Library/Application Support/melo-lite/config.json`
- theme / font / density / 各种显示开关 / icon 风格落盘并生效

**依赖**：F0。

## F8 — AI（Melo）

**产出**：还原期接 "coming soon" 的 AI 入口（slash 的 ai-write/summ/outline、Outline 底部卡片）接真实模型。

**依赖**：F2/F4（要有内容可喂）。**待定**：模型与调用方式；本地优先原则下的隐私边界（默认是否出网）。

---

## 跨阶段：菜单标注的快捷键

树内快捷键（F2 / ↵ / ⌫ / ⌘D / ⌘I）已随 F0 绑定。其余在各自功能落地时一并绑上，别再漏：
F1 搜索 → `⌘K`；F4 双链 → `⌘L`（Copy link）；F5 → `⇧⌘S`（全局分享）、`⌘P`（打印）。

## 跨阶段的待定（来自 architecture.md 末尾）

- Express 是否提供 HTTP 发布服务（一键发博客/静态站）
- Agent 集成方案（MCP / HTTP / 文件直写）——v1 不做，capture 入口已预留
- 主题/快捷键/字体的具体清单
- 孤儿附件扫描触发时机（启动 / 定时 / 手动）
