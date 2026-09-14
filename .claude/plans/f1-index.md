# F1 — Index Layer（SQLite）实施计划

_2026-06-12 起草。上游:[feature-plan.md](./feature-plan.md) F1 / [architecture.md](./architecture.md)_

## 目标与边界

给 workspace 建一份可随时重建的"卡片目录"：`.melo/index.db`。文件是 truth,索引是 cache
——铁律:删掉 index.db,任何时候都能从 `.md` 文件 100% 重建。

**F1 接真的 UI**：⌘K 搜索（文件名 + 全文）、Properties 卡的字数和标签。
**不在 F1**：智能文件夹吃真索引（F3）、backlinks 面板接真（F4,但 links 表本阶段就开始写入）、
编辑器/底栏（F4）。

## 表结构（架构 schema,一处修订）

```sql
files(id INTEGER PK, path TEXT UNIQUE, mtime, size, title, words)
  -- path 是 workspace 相对路径('/' 分隔):库跟着文件夹走,拷贝/搬家仍有效
tags(file_id, tag)
fields(file_id, key, value)        -- frontmatter 自定义字段
fts(content)                       -- FTS5 虚表,rowid 对齐 files.id
links(source_id, target)           -- target = [[wikilink]] 标题串,F4 解析
```

schema 版本用 PRAGMA user_version 把关:版本不符直接删表重建（索引即缓存,迁移=重扫）。

修订：架构原 schema 的 `links.anchor` 列去掉——标题级链接已否决,不留无主字段。
变更检测用 `mtime + size`（不算内容 hash:索引本来就可重建,误判代价只是多读一个文件）。

## 任务

### 1. 依赖与基建
- [x] better-sqlite3（主进程,native;项目已有 electron-builder install-app-deps 链路,
      pnpm onlyBuiltDependencies 白名单加一项;**装包时停 dev**）
- [x] gray-matter（frontmatter 解析:title/tags/自定义字段）

### 2. indexer 模块（主进程 `src/main/api/indexer.ts`）
- [x] openIndex(root)：打开/创建 `.melo/index.db`,建表（含 FTS5）
- [x] indexFile(path)：读 `.md` → frontmatter(tags/字段) + 标题（frontmatter > 首个 H1 > 文件名）
      + 纯文本(剥 markdown 语法) + 字数 + `[[wikilink]]` 目标 → upsert 五表
- [x] removeFromIndex(path)（rename = watcher 的 unlink+add）
- [x] fullScan(root)（异步爬取 + 分批让步 + generation 守卫 + 拷贝库清洗）：启动对账——遍历 `.md`,mtime/size 变了才重索引,消失的清掉;后台跑不阻塞 UI
- [x] 只索引 `.md`（其他类型先只进 files 表的元数据行,内容不进 FTS）

### 3. 与 watcher 衔接
- [x] watcher 的 add/change/unlink 事件 → 增量 indexFile/removeFile
- [x] 复用 OnWorkspaceChanged（watcher debounce 先消化索引;首扫完成也发一次）

### 4. IPC
- [x] `InvokeSearchIndex { query }` → 标题 + FTS 全文匹配,带高亮片段（snippet）
- [x] `InvokeGetFileMeta { path }` → { title, tags, words }
- [x] `InvokeGetAllTags` → tag → count 聚合（F3 智能文件夹会用,先备着）

### 5. renderer 接真
- [x] Properties 卡：字数 / 标签来自索引（开着时跟随扫描刷新）
- [x] ⌘K 搜索：按设计稿 spotlight 模式（PaletteB）还原——双栏弹层,左结果右预览,
      过滤 pill + 自动补全 + 命令模式(>) + Ask 模式(?,UI 还原/接 comingSoon),
      空态 Recents+Commands;is:starred 推迟到 F3
- [x] sb-search 点击 / ⌘K 唤起

### 6. 验收
- [ ] 外部改文件 → 搜索结果/字数自动跟上（watcher → 增量索引 → OnIndexChanged）
- [ ] 删掉 .melo/index.db 重启 → 自动重建,结果一致
- [ ] 大词量中文笔记可搜（FTS5 默认 tokenizer 对 CJK 的处理——见待定 ③）

## 待定决策

| # | 问题 | 建议 |
|---|---|---|
| ① | SQLite 驱动 | better-sqlite3(同步、快、生态标准);装包需停 dev + rebuild |
| ② | 搜索 UI | 设计稿没有,按还原语言自制(LinkPicker 风格弹层);以后设计稿补了再对齐 |
| ③ | 中文全文搜索 | FTS5 默认按空格分词,中文搜不准。建议 trigram tokenizer(FTS5 自带,中文/英文都能子串匹配,索引略大) |

## 顺序

1 → 2（此时可手动验证库内容）→ 3 → 4 → 5 → 6。每步一组 commit,过 codex 循环。
