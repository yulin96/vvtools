# 项目交接

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
