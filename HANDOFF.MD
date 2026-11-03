# 项目交接

## Homebrew 版本与发布同步

- 原配方使用 `version :latest`，普通 `brew outdated` / `brew upgrade` 会跳过，本机 `bu` 只调用这两个命令，因而无法更新。现已改为明确版本、版本化 DMG 地址和 ARM64/x64 独立 SHA-256，终端配置无需调整。
- `scripts/prepare-homebrew-cask.mts` 从实际发布包流式计算 SHA-256，生成 `.release/vvtools.rb`；发布 Action 仅在 GitHub Release 成功公开后，将该配方提交到 `main`。不要在安装包就绪前提交新版本配方，否则 Homebrew 会下载不存在的文件。
- 正常执行 `pnpm release:patch/minor/major` 即可，后续无需手工更新配方；Action 会额外生成一个配方提交，发布完成后先拉取远端 `main` 再开始本地开发。保留稳定 DMG 别名供旧版配方使用。
- 当前 `0.0.24` 配方校验值取自 GitHub Release 对应 DMG 的 `digest`。本地修改不会直接更新已安装 Tap，提交推送后需运行 `brew update` 再用普通升级命令验证。

## 界面文案与状态语义

- `activeCount` 同时包含排队和处理中的任务，整体状态及重启提示应使用“未完成”；任务行用“待开始”表示尚未提交，用“排队中”表示已进入队列。
- 字体范围摘要统计的是所选字符集合，并未与源字体字符取交集，应写“所选范围包含”，不能称为“预计保留”。字符子集处理需说明仅保留范围内的字符，快速转换同样使用中文 8105、西文和常用标点范围。
- 图片工作区与快捷动作共用“按画质／按文件大小”“画质／大小上限”“元数据／仅保留色彩配置”“自动编号”用语。命名规则和后缀的校验提示需在渲染进程与主进程保持一致，分别说明非法字符、未识别变量、缺少 `{name}`、长度及末尾句点问题。

## PDF 页面尺寸与任务提交

- PDFium 返回以点（pt）为单位的页面尺寸，常见 A4 页面为小数，不能按图片像素要求整数。
- `MediaInputMetadata.inputWidth/inputHeight` 在 PDF 任务中保留页面点数；`width/height` 在 PDF 压缩时也是点数，转图片时才是按 DPI 换算后的整数像素。
- IPC 校验按任务类型和操作区分单位：PDF 点数接受有限正数，图片像素仍要求正整数，并保留原有尺寸上限。
- 回归测试：`src/main/media/pdf-submission.test.ts` 使用真实生成的 PDF 和 PDFium 后台进程，覆盖无损压缩、有损压缩及转图片的提交元数据校验。

## Node 26 启动前 ZIP 解压退出

- `extract-zip@2.0.1` 原来依赖 `yauzl@2.10.0` / `fd-slicer@1.1.0`。本机 Node 26.13.0 解压超过流缓冲区的文件时未完成 Promise 就退出，提示 `Detected unsettled top-level await`、退出码 13；256 KB 随机内容的 ZIP 可稳定复现，小文件不能覆盖这个问题。
- 在 `pnpm-workspace.yaml` 中仅将 `extract-zip>yauzl` 固定为 `3.4.0`，保留现有流式解压、SHA-256 校验和各平台资源准备流程；同步提交锁文件。
- `scripts/extract-zip.test.ts` 在独立 Node 子进程中解压较大文件，检查退出码及完整内容，避免测试进程本身掩盖事件循环提前退出。
- pnpm 11 可能在 `run dev` 前自动补装依赖并执行 `postinstall`。遇到该调用链应修复资源准备的实际错误；`--config.verify-deps-before-run=false` 仅适合排查时使用已安装的依赖。
