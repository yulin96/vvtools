# 项目交接

## PDF 页面尺寸与任务提交

- PDFium 返回以点（pt）为单位的页面尺寸，常见 A4 页面为小数，不能按图片像素要求整数。
- `MediaInputMetadata.inputWidth/inputHeight` 在 PDF 任务中保留页面点数；`width/height` 在 PDF 压缩时也是点数，转图片时才是按 DPI 换算后的整数像素。
- IPC 校验按任务类型和操作区分单位：PDF 点数接受有限正数，图片像素仍要求正整数，并保留原有尺寸上限。
- 回归测试：`src/main/media/pdf-submission.test.ts` 使用真实生成的 PDF 和 PDFium 后台进程，覆盖无损压缩、有损压缩及转图片的提交元数据校验。
- 若 pnpm 11 在执行测试前自动安装依赖并因本地媒体资源暂存失败而中断，可用 `pnpm --config.verify-deps-before-run=false test <测试文件>` 运行已安装的依赖；不需要为运行测试打包应用。
