---
name: VVTools
description: 清晰、轻快、可信的桌面媒体批处理工作台
colors:
  primary: '#6957e8'
  primary-dark: '#6f5bd8'
  accent-lime: '#c8f05d'
  workspace: '#ffffff'
  surface: '#ffffff'
  sidebar: '#f5f5f7'
  sidebar-active: '#e6e6ec'
  foreground: '#1c1b27'
  muted: '#f2f2f5'
  muted-foreground: '#6d6b7c'
  sidebar-muted: '#6f6c7c'
  border: '#e3e2ea'
  dark-workspace: '#101116'
  dark-surface: '#18191f'
  dark-foreground: '#f3f1f8'
  dark-border: '#2d2e38'
  dark-danger-border: '#69373d'
  mac-window-close: '#ff5f57'
  mac-window-minimize: '#febc2e'
  mac-window-maximize: '#28c840'
  windows-window-close-hover: '#c42b1c'
typography:
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '16px'
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '12px'
    fontWeight: 600
    lineHeight: 1.35
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '14px'
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '11px'
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: '10px'
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.4
rounded:
  xs: '6px'
  sm: '8px'
  control: '9px'
  soft: '10px'
  navigation: '11px'
  medium: '12px'
  surface: '14px'
  feature: '16px'
  pill: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '#ffffff'
    rounded: '{rounded.control}'
    height: '36px'
    padding: '0 12px'
  surface-panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.surface}'
    padding: '16px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.control}'
    height: '38px'
    padding: '0 10px'
---

# Design System: VVTools

## Overview

**Creative North Star: “The Focused Media Desk”**

VVTools 是一张安静、清晰的媒体操作台。贯穿窗口的浅灰侧栏负责导航，右侧独立顶部栏标明当前位置与任务状态，白色内容区连续承载处理方式、参数、文件和结果。紫色只标识主操作、当前控件选择与进度；页面层级依靠对齐、间距与轻薄分隔建立，减少重复标题和嵌套面板。

主题提供跟随系统、浅色和深色三种模式。深色模式不是浅色模式的反相，而是以近黑工作区、深灰表面和更明亮的紫色建立同等层级。所有任务功能、状态语义和桌面操作习惯在两种主题下保持一致。

**Key Characteristics:**

- 连续内容区与轻薄分隔
- 中性导航选中态配合紫色主操作
- 可折叠导航为内容让出空间
- 短促、可关闭且只解释状态变化的动效

## Colors

系统使用中性工作区加单一紫色主色；语义状态拥有独立色彩，不借用品牌色表达成功或失败。

### Primary

- **Workflow Violet** (`#6957e8` / dark `#6f5bd8`)：主按钮、焦点、当前导航和处理中状态；两种模式下的小字号白字均满足 AA 对比度。
- **Live Lime** (`#c8f05d`)：保留为活动信号色，不用于静态导航选中标记或正文。

### Neutral

- **Quiet Sidebar** (`#f5f5f7`)：浅色导航区，与白色工作区通过右侧分隔线区分。
- **Pure Surface** (`#ffffff`)：配置区、表格和输入控件。
- **Night Workspace** (`#101116`)：深色应用工作区。
- **Night Surface** (`#18191f`)：深色内容表面。
- **Graphite Ink** (`#1c1b27`)：浅色主要文字。
- **Soft Divider** (`#e3e2ea`)：浅色边界与分隔。

### Native Window Chrome

- macOS 窗口控制点固定使用系统约定的红色 `#ff5f57`、黄色 `#febc2e` 和绿色 `#28c840`。
- Windows 关闭按钮悬停使用原生语义红色 `#c42b1c`；这些颜色只属于窗口控制，不进入业务状态体系。

**The Signal Rarity Rule.** 紫色只标识交互与进度，导航使用中性选中背景和紫色图标；不用活动点重复表达当前页面。

## Typography

**Display Font:** 系统无衬线字体栈
**Body Font:** 系统无衬线字体栈
**Label/Mono Font:** 仅路径、格式、尺寸和日志使用系统等宽字体

**Character:** 字体保持跨平台清晰稳定，通过字重与间距形成层级，不引入展示字体打断桌面工具的一致语气。

### Hierarchy

- **Headline**（600, 16px, 1.5）：应用顶部栏的页面名称与空状态标题。
- **Title**（600–700, 14px, 1.4）：配置分组、列表与表面标题。
- **Body**（400, 13px, 1.5）：表单说明和任务信息，长文本限制在 70ch 左右。
- **Label**（600, 12px, 1.35）：字段、按钮和元数据。

## Layout

应用采用贯穿窗口的两栏外壳，不设全周外边距与浮动大卡片。侧栏展开宽 208px、折叠宽 68px，仅保留右侧 1px 分隔线；macOS 折叠宽 80px，并在侧栏顶部保留 36px 原生控制点安全区。折叠入口位于品牌名称右侧，折叠后在同一位置居中显示展开按钮。侧栏的非交互区域可拖动窗口，折叠、导航和版本按钮显式保持 `no-drag`。右侧顶部栏高 56px，独立于滚动内容，统一显示页面图标、页面名称和任务状态；Windows 右侧预留 156px，避让原生窗口控制。Linux 保留系统标题栏，并使用同一工作区页眉。

处理页面使用 24px 水平边距、20px 顶部与 16px 底部留白。首行左侧放处理方式或预设、更多设置，右侧放输出位置和开始操作；配置摘要优先收缩省略，覆盖模式提示位于顶部页标题右侧，仅在媒体处理页面显示，使用紧凑提示并通过悬停补充完整说明；参数按意义分组，下方直接连接当前批次或空状态，不再重复页面标题。配置区最多使用工作区高度的 60%，内部可滚动且工具行保持可见；图片、视频、视频雪碧图和批量重命名的更多设置使用锚定按钮的非模态浮层，通过 Portal 脱离配置区文档流，展开收起不改变文件区高度。浮层宽 400px 并受可用宽度限制，最高 560px 且不超过可用高度，长内容内部滚动；字段按单列与紧凑分组排列，开关采用文字与开关同行。入口固定使用调节图标与“更多设置”，打开时呈淡紫色选中态；支持点击外部、Esc 关闭，Esc 关闭后焦点返回入口，关闭前提交当前输入并延续自动保存。文件区继承剩余高度，表格内部独立横纵滚动。常规参数使用三列，1100px 以下改为两列，工具行按可用空间换行。字体页用左对齐下划线导航区分转换与检查，用分段控件选择具体处理方式；压缩时先呈现字符范围，再呈现输出格式，后缀放在更多设置。

设置页保持独立整页滚动，字体检查保留信息与字形预览的独立滚动。任务表仅对表格本身设置边界与 10px 圆角，不再套外层卡片。页面切换保持 250ms 交叠淡入淡出，退场层脱离文档流，避免空白帧和内容宽度变化。macOS 使用系统悬浮滚动条，Windows/Linux 使用项目配置的 Chromium Overlay 与 Fluent Overlay 滚动条；不得用作者 CSS 覆盖原生滚动条。

## Elevation & Depth

静态内容主要依靠间距与 1px 分隔线分层。参数区保持平面布局，普通设置卡片和表格不叠加阴影；更多设置浮层使用细边界与轻阴影，模态框使用浮层阴影，窗口外壳的层级低于模态框。

**The Flat-at-Rest Rule.** 页面中的常驻表面不同时依赖强边框与宽阴影来证明存在。

## Shapes

输入与按钮使用 9px 圆角，导航使用 8px，任务表与字体预览使用 10px，设置表面使用 14px，模态框使用 16px。导入空状态的图标容器为 48px 方形、12px 圆角。小型状态、计数和开关轨道可以使用胶囊形；大容器不使用胶囊形。

## Components

### Buttons

- **Primary:** 紫色实底、白色文字、9px 圆角。
- **Secondary:** 表面底色加 1px 边界。
- **Hover / Focus:** 150ms 色彩反馈，焦点使用 3px 低透明紫色外环，按下仅产生 1px 位移。

### Cards / Containers

- **Background:** 主题表面色。
- **Border:** 1px 主题边界。
- **Shadow:** 只用于顶部配置、浮层和模态框。
- **Internal Padding:** 以 16px 为基础，复杂面板可使用 24px。

### Inputs / Fields

- **Style:** 38px 高、9px 圆角、主题表面与边界。
- **Focus:** 紫色边界加低透明焦点环。
- **Disabled:** 保留可读标签，整体降低不透明度，不隐藏状态原因。

### Navigation

导航默认使用中性文字，悬停出现轻灰/深灰背景；当前项使用中性选中背景、加重文字和紫色图标。图片、视频、雪碧图、音频、PDF 与字体处理放在上部，批量重命名与设置固定在底部工具区。版本行始终保留 18px 高度，折叠只隐藏内容，避免底部导航上下移动。导航项始终占满整行，图标占位宽度固定，缩进与侧栏宽度同步过渡；折叠后图标居中。主题切换放在设置页的“界面主题”中，提供带文字的跟随系统、浅色模式与深色模式选项，保留原有主题记忆与系统主题响应。

## Do's and Don'ts

### Do:

- **Do** 让文件、配置、任务状态和结果保持稳定的视觉关系。
- **Do** 在浅色和深色主题中分别校准表面、边界、文字与语义色。
- **Do** 将动效限制在 150–350ms，并遵循 `prefers-reduced-motion`。
- **Do** 用状态文字与图标共同表达结果。

### Don't:

- **Don't** 用大面积渐变、玻璃拟态或发光边缘制造“科技感”。
- **Don't** 用同尺寸数据卡片填满工作区，或增加与任务无关的指标。
- **Don't** 为每个元素添加悬浮位移；动效只解释导航、主题、展开和页面状态变化。
- **Don't** 在大容器上使用胶囊形或嵌套卡片。

### 配置项优先级

各工作区优先展示直接决定处理结果的常用选项。图片、视频保留现有主配置；更多设置按文件命名、画面、音轨及编码分组。雪碧图将采样方式放在更多设置前，主区按采样参数与图片格式、排版、导出排列；范围、画布样式及质量命名收在浮窗。音频将输出格式放在更多设置前，主区为码率、统一音量，声道与后缀收在浮窗。PDF 按模式展示格式、分辨率及质量，后缀使用统一浮窗入口；无损压缩只显示说明。字体压缩先选字符范围，后选格式；重命名自定义模式直接展示查找替换。设置页先展示文件输出规则，再展示主题、系统集成与调度，更新及组件信息置后。

更多设置沿用锚定浮窗，按触发位置缩放淡入 250ms、关闭 150ms，由 Reka 的挂载生命周期承接退出动画。PDF、字体处理与重命名模式切换交叠淡入淡出 150ms，退场内容脱离文档流；页面切换保持 250ms，位移收敛至 8px。系统减少动态效果时关闭这些过渡。
