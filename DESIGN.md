<!-- SEED: re-run $impeccable document once there's code to capture the actual tokens and components. -->
---
name: vvtools
description: 专业、高效、克制的内部媒体批处理桌面工具
---

# Design System: vvtools

## Overview

**Creative North Star: "The Calm Operations Desk"**

vvtools 应像一张秩序清楚的媒体操作台：用户打开软件就能理解待处理文件、处理规则、任务状态和最终结果之间的关系。视觉以 icon 的深蓝灰、清透蓝青和冰灰为身份锚点，默认采用适合办公室长时间工作的浅色界面，信息密度舒适而不松散。

系统借鉴 Linear 的层级与克制、Raycast 的桌面效率和 HandBrake 对任务流程的表达，但不复制任何单一产品。界面不追求炫技或戏剧化品牌展示；每一个颜色、层级和动效都必须帮助用户建立任务、判断状态或处理异常。

**Key Characteristics:**

- 冷静的深蓝灰骨架与少量蓝青强调
- 清楚、紧凑但不拥挤的桌面信息层级
- 任务状态优先，装饰退后
- 熟悉、可预测并支持键盘操作的控件行为
- 对长任务、失败和部分成功提供持续反馈

## Colors

采用克制色彩策略：冷白与冷灰承担大面积结构，icon 的深蓝灰建立可信度，蓝青只用于主操作、当前选择、进度和焦点等具有明确意义的状态。

### Primary

- **Operations Navy**（深蓝灰）：用于主要文字、导航骨架和高对比主操作。[to be resolved during implementation]
- **Signal Cyan**（清透蓝青）：用于品牌识别、进度和选择状态；不得直接承载白色小字号文字。[to be resolved during implementation]
- **Accessible Cyan**（加深蓝青）：用于需要白字的交互填充、链接和焦点状态。[to be resolved during implementation]

### Neutral

- **Workspace White**（冷白）：应用工作区背景。[to be resolved during implementation]
- **Pure Surface**（纯白）：面板、表格和主要内容表面。[to be resolved during implementation]
- **Ice Divider**（冰灰）：分隔线、输入框边界和低强调容器。[to be resolved during implementation]
- **Secondary Ink**（冷灰文字）：辅助说明和元数据，必须满足正文对比度要求。[to be resolved during implementation]

**The Ten Percent Signal Rule.** 蓝青在单个界面中的视觉占比不得超过约 10%；它的稀缺性用于帮助用户快速定位操作和状态。

**The Semantic Independence Rule.** 成功、警告和错误必须拥有独立语义色，不能仅靠品牌蓝青区分，也不能只靠颜色传递状态。

## Typography

**Display Font:** [single sans family to be chosen at implementation]

**Body Font:** [single sans family to be chosen at implementation]

**Label/Mono Font:** [system monospace stack to be chosen at implementation]

**Character:** 使用一套技术型、略带人文感的无衬线字体贯穿标题、正文、标签和控件，优先保证 Windows、macOS 和 Linux 上的清晰度与稳定性。等宽字体只用于编码参数、路径、尺寸、时长和日志等机器信息。

### Hierarchy

- **Display:** 仅用于空状态或首次引导中的短标题，不用于常规任务界面。[to be resolved during implementation]
- **Headline:** 页面或主要工作区标题，强调当前位置而非制造视觉口号。[to be resolved during implementation]
- **Title:** 面板、任务和分组标题。[to be resolved during implementation]
- **Body:** 表单说明、任务描述和结果信息，长文本控制在 65–75ch。[to be resolved during implementation]
- **Label:** 表单标签、表头、按钮和元数据，保持自然大小写，不使用到处可见的宽字距全大写。[to be resolved during implementation]

**The One Interface Voice Rule.** 不使用展示字体或相似但不一致的字体组合；层级依靠字号、字重和间距，而不是更换字体制造差异。

## Elevation

默认采用平面与色调分层。工作区、侧栏和浮层通过背景层级、边界和遮罩建立空间关系；阴影只在下拉菜单、拖拽对象、弹窗和悬浮反馈等真实离开平面的状态中出现。

**The Flat-by-Default Rule.** 静止内容不依赖阴影分组；若一个表面同时需要宽阴影和边框才能被看见，说明层级或背景选择不正确。

## Components

当前仍是 electron-vite 初始模板，shadcn-vue 组件尚未形成项目级视觉实现。按钮、输入框、任务队列、进度、文件选择、结果摘要和错误状态将在首个真实界面完成后由 `$impeccable document` 扫描并写入正式规范。

## Do's and Don'ts

### Do:

- **Do** 围绕文件、规则、进度和结果建立稳定的信息结构。
- **Do** 使用标准桌面控件行为，并为核心流程提供完整键盘操作和清晰的焦点状态。
- **Do** 将交互反馈控制在 150–250ms，动效只用于状态变化和操作反馈。
- **Do** 对耗时任务展示持续进度，并明确区分成功、部分成功、失败和取消。
- **Do** 让高级参数渐进披露，保持高频操作路径短而清楚。

### Don't:

- **Don't** 采用炫技、游戏化或过度装饰的视觉表达。
- **Don't** 照搬复杂专业媒体软件中高密度、难学习的控制台式界面。
- **Don't** 为了显得强大而暴露非必要参数、制造层层面板或使用缺乏任务意义的动效。
- **Don't** 模仿 Adobe Premiere Pro 式密集面板与参数暴露，让内容运营人员面对专业剪辑台般的复杂度。
- **Don't** 使用渐变文字、默认玻璃拟态、装饰性网格背景或嵌套卡片。

