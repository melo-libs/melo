# Melo Lite v2 视觉还原 — 执行计划

_Last updated: 2026-06-24_
_关联文档：[architecture.md](./architecture.md)_

## 总览

本阶段目标：**按设计稿做到像素级视觉还原 + 包括交互**，但不实现真业务。

"交互"指 UI 状态切换——菜单打开关闭、tab 切换、hover/active、模态弹出。**编辑器不接真 Tiptap，只渲染静态 block 数组**。后续功能阶段再把 mock 替换成真实现。

参考资源（在 `.reference/`）：
- `tiptap/` 主仓 + `tiptap-docs/` —— 写 Tiptap 相关代码前先查
- `tiptap-notion-ref` —— SCSS + Radix + Tiptap UI Components 模式参考

## 栈定型

- React 18 + TS（项目已有）
- **样式：SCSS + CSS 变量**（不用 Tailwind，但保留 config 不强删）
- **行为原语：Radix UI + Ariakit + @floating-ui/react**（不用 HeroUI）
- **编辑器：Tiptap v3**（视觉阶段不接，留接口）
- **图标：手写 inline SVG**（按设计稿 icons.jsx 端口）
- **字体：本地化 Source Serif 4 / Inter / JetBrains Mono**

## 推倒重来策略

旧的 Sidebar.tsx、JotaiSidebar.tsx、SidebarHeader.tsx、Toolbar / Toolbar2、MarkdownEditor、SearchAndReplace、Surface.tsx、IconButton.tsx、MIcon.tsx、pages/settings 等组件**全部删掉重写**。

## 由 JSX 阅读引出的几个尾巴决策（写入此处供后续锚定）

- **Settings 用 Tweaks.jsx 的"三旋钮"**（Mood / Texture / Voice），不暴露 App.jsx 的技术控件
- **AI 入口三处都做 "coming soon"**：BubbleMenu 的 "Ask Melo"、BlockMenu 的 "Improve with Melo"、SlashMenu 的 AI 项
- **BubbleMenu 高亮系统全做**：7 文字色 + 7 背景色 + Clear
- **Top bar Export / More 菜单**：UI 全做，逻辑只接核心（Export 三种格式 + Move + Trash），其它点击空响

## 阶段分组

### Phase 0 — 基础设施 ✅

地基。后面所有阶段都依赖这个。

- [x] 卸载 HeroUI（package.json + 所有 import + tailwind plugin）
- [x] 装 Radix UI 原语（dialog、context-menu、dropdown-menu、popover、tabs、tooltip、switch、toggle-group、slot）
- [x] 装 Ariakit
- [x] 删旧组件树（Sidebar / JotaiSidebar / SidebarHeader / Toolbar / Toolbar2 / MarkdownEditor / SearchAndReplace / Surface / IconButton / MIcon 等）
- [x] 删 pages/settings 旧版
- [x] 建新 SCSS 目录：`src/renderer/src/styles/{tokens.scss, reset.scss, mixins.scss, index.scss}`
- [x] 翻译设计稿 tokens.css → tokens.scss（暖纸调色板 + 类型尺度 + 布局 + 阴影 + 圆角 + 动画）
- [x] 本地化字体（Source Serif 4 / Inter / JetBrains Mono）— 通过 @fontsource-variable 引入
- [x] 实现 Icon 组件：端口设计 icons.jsx 的 ~70 个 SVG 到 TS
- [x] 实现 FileTypeIcon（tile + glyph 模式）
- [x] `lib/cn.ts` className 合并工具

### Phase 1 — App Shell ✅

- [x] 三栏 grid 布局（sidebar-w + 1fr + outline-w，CSS 变量驱动可隐藏）
- [x] Electron 窗口 hiddenInset + macOS 红绿灯位置
- [x] 全局 SCSS：reset、字体、滚动条样式

### Phase 2 — Sidebar ✅

**2.1 顶部**
- [x] 红绿灯空位 `sb-traffic`
- [x] Workspace 切换器（弹出列表 + 当前选中 + 新建/打开/管理 + ⌘1-9 提示）
- [x] 搜索栏（icon + input + ⌘K kbd）
- [x] Collect 按钮（icon + label + paste URL 提示）
- [x] Workspace section header（标题 + 新建按钮）

**2.2 File Tree**
- [x] TreeNode 递归组件，缩进式展开
- [x] 文件夹 chevron 展开状态
- [x] 文件 tile 图标（按 kind 分组色）
- [x] active row 高亮
- [x] Inbox 特殊样式 + 未读数
- [x] Source dot（剪藏内容的网站 favicon）
- [x] 星标置顶图标
- [x] Recent pulse 动画
- [x] 拖拽 URL 到文件夹的视觉反馈

**2.3 底部**
- [x] Storage 显示（"Local · 2.3 GB" + 进度条）
- [x] 同步、设置图标按钮

### Phase 3 — Editor 顶栏 + Tab 栏 ✅

- [x] 顶栏：sidebar 切换 + breadcrumb + 保存状态 + History / Export / Theme / Outline / More 按钮 + tooltip
- [x] Export 顶栏菜单（PDF / Markdown / HTML / 复制富文本 / Print）
- [x] More 顶栏菜单（Share / Copy link / Reveal / Favorite / Tag / Move / Focus mode / Typewriter / Info / Trash）
- [x] Tab 栏（icon + title + dirty 圆点 + 关闭按钮 + +new tab）

### Phase 4 — Editor 画布 ✅

- [x] ed-page 容器 + 宽度变体（default / wide / full）
- [x] Title + subtitle
- [x] Block 渲染基础结构（左侧 gutter：+ 按钮 + 拖手柄；block-content 内容）
- [x] 各 block 类型样式：h1 / h2 / h3 / p / quote / bullet / num / task（含 checkbox） / code（含 highlight + lang badge） / image（含 SVG 渐变占位） / divider
- [x] toggle / callout 降级为普通 markdown
- [x] 底栏（词数 / 阅读时间 / Markdown · UTF-8 / 创建时间 / Ln Col / 缩放）

### Phase 5 — Editor 浮层 ✅

- [x] SlashMenu（分段、AI 项带 MELO 徽章、方向键导航、Esc 关闭）
- [x] BubbleMenu 主体（Turn into 触发器 + bold / italic / underline / strike / code + Link + 高亮触发器 + Ask Melo）
- [x] FormatDropdown（9 种 block type，含 sample 字形）
- [x] HighlightDropdown（7 文字色 + 7 背景色 + Clear）
- [x] BlockMenu（gutter 点击：Turn into H2 / Quote / Callout + Duplicate + Copy link + Improve with Melo + Delete）

### Phase 6 — Outline 右栏 ✅

- [x] Tabs：Outline / Info / Links（用 Radix Tabs）
- [x] Outline 列表（标题 + heading 项 + 层级缩进 + active 高亮 + 滚动同步）
- [x] Info 面板：path / updated / words / reading / format
- [x] Tags pill 列表
- [x] Meet Melo 卡片（fish 图标 + 标语 + Join waitlist）

### Phase 7 — 文件管理覆盖层 ✅

- [x] ContextMenu（带 head 区、action 列表、submenu，用 Radix ContextMenu）
- [x] Move to 子菜单（列所有 folder）
- [x] Export as 子菜单（PDF / HTML / Markdown）
- [x] PropertiesCard（modal + scrim + source / tags / words / type 行）
- [x] Favicon helper（muted + color 两种调子）

### Phase 8 — Collect ✅

- [x] CollectCard idle 阶段（URL 输入 + folder 选择 + Capture）
- [x] fetching 阶段（spinner + host 显示）
- [x] ready 阶段（preview tile + title + host + words + excerpt + Save 按钮）
- [x] 拖 URL 到文件夹触发 Collect 流程

### Phase 9 — Share / Express ✅

- [x] ShareCard 模态 + 3 预设（Manuscript / Minimal / Ink）
- [x] 可选元素（标题 / 来源 / 日期 / 签名 / 水印）
- [x] 实时预览（DOM 渲染）
- [x] 复制到剪贴板 / 下载 PNG（SVG foreignObject → canvas）

### Phase 10 — Settings（推迟到最后）

**2026-06-11 决定：Settings 单独做一个设置页面，放到所有阶段的最后再做。**
届时再定它和 Tweaks.jsx 三旋钮（Mood / Texture / Voice）、architecture.md
"抽出正式 Settings" 决策之间的取舍。

### Phase 11 — Smart Views + Backlinks ✅

- [x] Smart Views（SmartView + SmartBuilder + SmartControls + SmartIcon）

Backlinks（按 DualLinks.jsx，**只到笔记级——`[[note#heading]]` 不做**；Local graph 保留）：

- [x] 行内 wikilink chip（⟦⟧ 括号、missing 灰样式）
- [x] hover peek 预览卡（摘录 + Open note / Create note）+ 点击导航 toast
- [x] 文档底部 Backlinks 面板（Linked references 分组 + Unlinked mentions 可升级）
- [x] LinkPicker（slash 触发的笔记选择弹层，含 Create 行）
- [x] 右栏 Links tab（Local graph + Outgoing + Backlinks 列表）

---

## 执行节奏建议

- 一个 Phase 一组 commit（按子项粒度，每个有意义的视觉节点一 commit）
- 每个 Phase 结束跑一遍 dev server 视觉验收

> 还原阶段收尾后转入功能落地，见 [feature-plan.md](./feature-plan.md)——
> 把这里铺好的 UI 从 sample 数据换成真实现（文件系统、索引、capture 抓取等）。
