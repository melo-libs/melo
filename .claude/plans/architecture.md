# Melo Lite 架构方案

_Last updated: 2026-06-12_

> **术语修订（2026-06-12）**：产品语言从 vault 统一改为 **workspace**。
> 理由：vault 听上去是静态的存储空间；workspace 是动态的工作空间——从收集、
> 编辑创作到输出，加上后续的 AI 能力，用户的整个工作闭环都发生在这里。
> 磁盘形态不变：workspace 仍然就是一个普通文件夹。

## 产品定位

Melo Lite 是一个本地优先的个人知识库桌面应用。

核心命题：**Collect → Organize → Distill → Express**（简称 CODE）。这四个动作之间的丝滑流动构成"第二大脑"，是产品的主线。

## 设计原则

四条硬约束（违反前必须有强证据）：

1. **The Art of Simplicity（极简主义）**：做减法，不做加法
2. **Zero learning curve（零学习成本）**：不发明新概念，用用户已经熟悉的东西
3. **Local-first（本地优先）**：数据完全在用户设备上，不强制云端
4. **Standard file formats（标准文件格式）**：拒绝专有格式锁定

由原则推导出的关键决策：
- 不发明新的组织方式 → 直接用操作系统的文件夹结构，不引入 workspace 之上的数据库式抽象
- 不绑定云端 → 没有账号、没有同步服务、没有订阅
- 不锁定格式 → 文件就是 `.md`，frontmatter 是 YAML，引用是 `[[wikilink]]`（Obsidian 兼容）

## 功能模块

### CODE 主线

**Collect（收集）**
- Inbox：系统级"未分类"文件夹，所有捕获默认进这里
- 应用内快速捕获快捷键
- 浏览器扩展（通过本地 HTTP server 接入）
- Agent 集成（v1 不实现，但架构里要预留 capture 统一入口）

**Organize（组织）**
- 文件树（文件系统原生）
- Tags（扁平、只在 frontmatter）
- Smart Views（按 tag / 日期 / 修改时间筛选的预设视图）
- Workspace（单 workspace 在线，可切换）

**Distill（提炼）**
- Editor（Tiptap WYSIWYG markdown）
- Bi-directional Links（`[[note]]` 语法、补全、跳转）
- Backlinks 面板
- Search（全文 + frontmatter 字段）

**Express（表达）**
- Editor（同上，写作时与 Distill 共用）
- Export：HTML、PDF、图片
- 卡片分享（笔记内容生成图片，发社交媒体）

### 支撑层

- App Shell：单窗口、多 tab、三栏布局、菜单栏常驻
- Filesystem Layer：文件读写 + 监听变化
- Index Layer：SQLite（搜索、tags、backlinks）
- IPC Layer：main ↔ renderer
- State Layer：Jotai
- Assets Layer：附件存储与引用管理
- Settings Layer：应用 + workspace 级偏好

## 数据模型

### 数据分四类

**1. 用户内容**（用户拥有，必须可移植、用别的工具能打开）
- Markdown 文件 + frontmatter
- 文件夹结构
- 附件（图片等）

**2. 派生数据**（从用户内容算出来的，删了能重建）
- 全文搜索索引
- Tag 聚合
- Backlink 图
- 文件元数据缓存（路径、修改时间、大小）

**3. 工作区状态**（这个 workspace 的运行时状态）
- 打开的 tab、激活的 tab
- 最近打开文件
- Smart Views
- workspace 级偏好

**4. 应用全局状态**（跨 workspace）
- Workspace 列表、上次用的 workspace
- 主题、字体、全局快捷键
- 浏览器扩展配对密钥

### 存储位置

```
my-workspace/
├── Inbox/                     # 用户内容
├── 用户自己的文件夹/
│   └── *.md
├── .assets/
│   └── YYYY/MM/uuid.ext       # 附件按时间 + uuid
└── .melo/                     # 派生数据 + 工作区状态
    ├── index.db               # SQLite
    ├── workspace.json         # tab、最近文件
    ├── views.json             # smart views
    └── settings.json          # workspace 级偏好

~/Library/Application Support/melo-lite/   # macOS：应用全局状态
└── config.json                # workspace 列表、主题、快捷键、扩展密钥
```

关键不变量：
- 索引数据库 `.melo/index.db` 任何时候都可以从 `.md` 文件 100% 重建
- 用户内容里没有任何 app 专属格式，删掉 app 用 VS Code 打开都能读懂
- `.melo/` 跟着 workspace 走，用户在别的电脑打开同一个 workspace，连 tab 状态都能恢复

### 核心 Schema

**Note**（内存形态，磁盘上是 `.md` 文件）

```ts
{
  path: string              // 相对 workspace 根
  frontmatter: {
    tags: string[]
    created: ISO date
    updated: ISO date
    [key: string]: any      // 自定义字段
  }
  body: string              // 原始 markdown 文本
  doc?: ProseMirrorDoc      // 解析后；仅当前编辑中的笔记有
}
```

**Index DB**（SQLite 主要的表）

```sql
files(id, path, mtime, hash, title)
tags(file_id, tag)                       -- 一文件多 tag
fields(file_id, key, value)              -- frontmatter 自定义字段
fts(file_id, content)                    -- SQLite FTS5 全文搜索
links(source_id, target_path, anchor)    -- 双链关系
```

**Tab**（联合类型）

```ts
type Tab =
  | { kind: 'note', path: string, scroll: number }
  | { kind: 'search', query: SearchQuery }
  | { kind: 'smart-view', view_id: string }
  | { kind: 'settings', section: string }
```

**Smart View**

```ts
{
  id: string
  name: string
  query: {
    tags?: string[]
    folder?: string
    created_after?: ISO date
    modified_after?: ISO date
    text?: string
  }
  sort: 'created' | 'updated' | 'name'
}
```

## Pipeline

三段流水线，所有数据流都走这条：

- **抓取**：所有来源（app 快捷键、浏览器扩展、未来的 agent）调用同一个内部 `capture` 函数。capture 函数从 v1 就要存在
- **存入**：写到文件系统 + 同步更新索引。文件是 truth，索引是 cache
- **展示**：编辑器、列表、搜索结果、backlinks 面板，从文件 + 索引里组装出来

客户端（浏览器扩展、agent）是 pipeline 入口的 adapter，加新的不会动 pipeline 中间任何环节。

## 关键设计决策

| 决策 | 选择 | 否决项 |
|---|---|---|
| 双链粒度 | 只到笔记级 `[[note]]` | 标题级 `[[note#heading]]`、块级 `[[note^id]]` |
| Tags 层级 | 扁平 | 嵌套（`#a/b`） |
| Tags 写法 | 只在 frontmatter | 行内 `#tag` |
| 附件路径 | `.assets/YYYY/MM/uuid.ext` | 按笔记分、跟笔记同目录 |
| 附件命名 | uuid | 原文件名、时间戳 |
| 索引位置 | workspace 内 `.melo/index.db` | 系统配置目录 |
| 窗口模型 | 单窗口 + 多 tab | 多窗口、分屏 |
| Workspace 在线 | 单 workspace | 多 workspace 同时 |
| Collect 接收端 | 菜单栏常驻 + 本地 HTTP server | 单独后台进程、不做后台 |
| Export 格式 | HTML、PDF、图片 | Word |

## v1 视觉还原阶段的范围说明

- **AI 入口（Melo）**：设计稿有 slash menu 的 ai-write / ai-summ / ai-outline + Outline 底部 waitlist 卡片。视觉先还原，入口接 "coming soon"，逻辑不实现
- **Tweaks → Settings**：设计稿里的 Tweaks 是设计平台的调试工具，不做。但里面 theme（明/暗）、font（serif/sans/mono）、density（comfortable/compact）、sidebar/outline 显示、Inbox 显示、扩展名显示、icon 风格——这些抽出来做成正式 Settings
- **Smart Views**：保留，但设计稿这版还没体现，需要补一份
- **双链 / Backlinks**：保留，设计稿这版也没体现，跟 Smart Views 一起补

## 已否决方案（避免后续反复）

- **Graph View（全局图）**：违反极简、实际使用价值低。
  ↳ 2026-06-11 修订：右栏 Links tab 里的 **Local graph（当前笔记的局部关系图）保留**，
  按设计稿还原；被否决的是独立的全局 Graph View 页面
- **Dataview**：违反零学习成本，引入查询语言
- **嵌套 Tags**：本质上是另一套文件夹，跟现有文件夹功能重复
- **行内 `#tag`**：一物两写，制造混乱
- **标题级 / 块级双链**：命中率不稳定（heading 不一定对应概念）、heading 重命名导致链接静默失效、增加 syntax 学习成本
- **多 Workspace 同时在线**：与单窗口冲突
- **分屏**：复杂度增加，收益小
- **Word 导出**：极少用户需求
- **Toggle / Callout 自定义块**：不做 Tiptap 自定义节点。callout 降级为段落 + emoji 保留视觉，toggle 降级为可折叠的 heading + 内容

## 待定 / 后续讨论

- Express 是否提供 HTTP 发布服务（一键发到博客、静态站）
- Agent 集成方案（MCP / HTTP / 文件直写）——v1 不做，但 capture 入口要预留
- 主题、快捷键、字体选项的具体清单
- 孤儿附件扫描的触发时机（每次启动？定时？手动？）
