---
name: VVTools
description: 清晰、轻快、可信的桌面媒体批处理工作台
colors:
  primary: '#6957e8'
  primary-dark: '#6f5bd8'
  accent-lime: '#c8f05d'
  workspace: '#f5f5f9'
  surface: '#ffffff'
  foreground: '#1c1b27'
  muted: '#f0eff5'
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
    fontSize: '24px'
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: '-0.02em'
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

VVTools 是一张安静但不沉闷的媒体操作台。浅灰工作区和白色表面负责承载长时间操作，清晰紫色只标识主操作、当前选择与进度；青柠色只作为小面积的活动信号。界面从 Dribbble 参考中的轻薄分隔、柔和选中态和宽松层级取材，但保持内部工具应有的可预测性与信息效率。

主题提供跟随系统、浅色和深色三种模式。深色模式不是浅色模式的反相，而是以近黑工作区、深灰表面和更明亮的紫色建立同等层级。所有任务功能、状态语义和桌面操作习惯在两种主题下保持一致。

**Key Characteristics:**

- 轻薄边界与清楚的表面层级
- 紫色主操作配合稀缺的青柠活动信号
- 可折叠导航为内容让出空间
- 短促、可关闭且只解释状态变化的动效

## Colors

系统使用中性工作区加单一紫色主色；语义状态拥有独立色彩，不借用品牌色表达成功或失败。

### Primary

- **Workflow Violet** (`#6957e8` / dark `#6f5bd8`)：主按钮、焦点、当前导航和处理中状态；两种模式下的小字号白字均满足 AA 对比度。
- **Live Lime** (`#c8f05d`)：只用于活动点或极小面积的确认信号，不承载正文。

### Neutral

- **Cool Workspace** (`#f5f5f9`)：浅色应用工作区。
- **Pure Surface** (`#ffffff`)：配置区、表格和输入控件。
- **Night Workspace** (`#101116`)：深色应用工作区。
- **Night Surface** (`#18191f`)：深色内容表面。
- **Graphite Ink** (`#1c1b27`)：浅色主要文字。
- **Soft Divider** (`#e3e2ea`)：浅色边界与分隔。

### Native Window Chrome

- macOS 窗口控制点固定使用系统约定的红色 `#ff5f57`、黄色 `#febc2e` 和绿色 `#28c840`。
- Windows 关闭按钮悬停使用原生语义红色 `#c42b1c`；这些颜色只属于窗口控制，不进入业务状态体系。

**The Signal Rarity Rule.** 紫色只标识交互与进度，青柠只标识活动状态；二者都不用于装饰性铺色。

## Typography

**Display Font:** 系统无衬线字体栈
**Body Font:** 系统无衬线字体栈
**Label/Mono Font:** 仅路径、格式、尺寸和日志使用系统等宽字体

**Character:** 字体保持跨平台清晰稳定，通过字重与间距形成层级，不引入展示字体打断桌面工具的一致语气。

### Hierarchy

- **Headline**（700, 24px, 1.3）：页面位置与主要工作区标题。
- **Title**（600–700, 14px, 1.4）：配置分组、列表与表面标题。
- **Body**（400, 13px, 1.5）：表单说明和任务信息，长文本限制在 70ch 左右。
- **Label**（600, 12px, 1.35）：字段、按钮和元数据。

## Layout

应用使用统一的 8px 外框系统：左侧导航以 8px 距离浮于窗口内，展开宽 228px、折叠为 68px，并与右侧工作区保持 8px 间隔；四边 1px 边框和 16px 圆角建立工具坞边界。侧栏的非交互区域均可拖动窗口，导航、折叠、主题与未来的表单控件必须显式保持 `no-drag`。窗口使用 40px 无底色自定义拖拽层：macOS 控制点落在左侧导航上方，Windows/Linux 控制按钮位于右上角；页面标题与配置面板从 40px 安全线之后开始，但右侧工作区容器本身仍贴合窗口。处理页的整个右侧工作区都是拖放表面，最外层边界统一距四周 8px；文件、待处理列表和任务结果沿稳定纵向流程出现。常规页面使用 20px 水平边距和 22px 分组间距；1100px 以下配置组转为单列，任务表隐藏次要列但保留核心状态和操作。macOS 使用系统悬浮滚动条，Windows/Linux 在当前 Electron 39 / Chromium 142 上启用 Chromium Overlay 与 Fluent Overlay 滚动条；不得用作者 CSS 覆盖原生滚动条，也不得因页面切换改变内容宽度。

## Elevation & Depth

静态内容主要依靠背景与 1px 边界分层。顶部配置面板使用低层环境阴影，弹出高级设置和模态框使用更深的浮层阴影；普通设置卡片和表格不叠加阴影。

**The Flat-at-Rest Rule.** 页面中的常驻表面不同时依赖强边框与宽阴影来证明存在。

## Shapes

输入与按钮使用 9px 圆角，导航使用 11px，主要表面使用 14px，导入区和模态框使用 16px。小型状态、计数和开关轨道可以使用胶囊形；大容器不使用胶囊形。

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

导航默认使用中性文字，悬停出现轻灰/深灰背景；当前项使用柔和紫色表面、紫色文字和一个小型青柠活动点。底部使用系统、浅色、深色三个纯图标主题按钮。折叠后所有导航图标严格居中，主题区只显示当前模式图标且不可切换；展开后恢复三项主题选择。

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
