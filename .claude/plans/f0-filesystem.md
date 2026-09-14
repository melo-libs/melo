# F0 — Filesystem Layer 实施计划

_2026-06-12 起草,动工前供过目。上游:[feature-plan.md](./feature-plan.md) F0 / [architecture.md](./architecture.md)_

## 目标与边界

侧栏文件树从真实磁盘来,文件管理操作全部落到真实文件系统,外部改动能自动回灌 UI。

**明确不在 F0 里**:编辑器仍显示 sample 文档——"打开真实 .md 编辑 + 保存"整体留给 F4
（能编辑却不能存盘的半残状态会丢数据,不做中间态）。Collect、Smart Folders、双链的
sample 数据也原样保留,分别等 F2 / F3 / F4。

**现状盘点**:主进程已有一套带类型的 IPC（开目录、递归列目录、读写/重命名/删除/新建/
移动、stats、记住上次目录、reveal in Finder），沿用其通道协议,按需补缺口；缺文件监听。

## 任务

### 1. Workspace 会话
- [x] 启动时恢复上次 workspace（`InvokeGetLastDirectory` 已有）
- [x] 没有 workspace 时的空状态页：还原语言的引导卡（选择文件夹 / 新建 workspace），这块设计稿没有,自制但克制
- [x] WorkspaceSwitcher 显示真实 workspace 名（多 workspace 列表仍是 sample,切换接 comingSoon）

### 2. 目录扫描 → 文件树
- [x] `InvokeListDirectory` 结果映射成 renderer 的 `FileNode`（kind 由扩展名推断,复用 FILE_TYPES 的 ext 表）
- [x] 过滤规则（Inbox 按名字约定,首次打开自动创建）：隐藏 `.assets/`、`.melo/`、点文件；Inbox 文件夹识别为 system inbox（按名字 `00 Inbox`/`Inbox`?——**待定 ①**）
- [x] Sidebar 的 `SAMPLE_TREE` 换成磁盘数据;展开状态、Inbox 计数照常工作

### 3. 文件操作真实化（复用还原期的交互语义）
- [x] New note（侧栏 "+" → 树顶行内输入;文件夹创建暂走 Finder/watch 回灌）
- [x] Rename：行内重命名输入（renderer 没有 window.prompt,补一个 inline 编辑态）
- [x] Duplicate / Move to / Copy path（真实绝对路径）
- [x] Delete → 系统废纸篓（shell.trashItem）（`shell.trashItem`,不直接 rm——**待定 ②**）
- [x] Reveal in Finder 接已有 IPC
- [x] Properties 卡读真实 stats（大小、修改时间;字数等内容指标留给 F1 索引）

### 4. 文件监听（新增）
- [x] 主进程 watch workspace 目录（chokidar@4,Electron 31 兼容;App 层持有,关窗自动释放）（chokidar——**待定 ③**),debounce 合并成批
- [x] 新增 main→renderer 事件通道（OnWorkspaceChanged,300ms debounce）,renderer 收到后刷新对应子树
- [x] 回声抑制：重扫幂等,自发操作的双扫无害,不做额外抑制：自己发起的操作不触发二次刷新（操作期间挂起 watch 或按路径短期屏蔽）

### 5. 收尾
- [x] 清理 `sampleData.ts`（整文件删除,无引用）
- [x] 手动验收通过（rename/拖拽/外部回灌实测;期间修复:rename 焦点被右键菜单抢走、
  stale 树自愈、主进程返回值兼容、URL 拖放 dragover、Windows 路径守卫）

**追加完成（设计稿更新带来的）**：文件类型后缀展示（dimmed .ext,弃用 chip 徽章）、
树内拖拽(移入文件夹 + URL 拖放收集)。**有意不做**：同文件夹内手动排序——目录按
名字排序,自定义顺序需要 .melo 持久化;用户确认维持现状(2026-06-12)。：真实文件夹增删改移 + 外部 Finder 操作回灌

## 待定决策（动工前定）

| # | 问题 | 我的建议 |
|---|---|---|
| ① | Inbox 文件夹怎么识别 | 名字约定 `Inbox`（无则首次打开时创建）,与架构 "系统级未分类文件夹" 一致 |
| ② | 删除行为 | `shell.trashItem` 进系统废纸篓,可在 Finder 找回 |
| ③ | watch 实现 | chokidar（跨平台稳、debounce/忽略规则现成）,原生 fs.watch 的 recursive 在 Linux 不可用 |

## 顺序

1 → 2（此时树只读可浏览）→ 3 → 4 → 5。每步一组 commit,过 codex 循环。
