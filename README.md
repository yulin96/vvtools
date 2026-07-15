# VVTools

VVTools 是一款公司内部使用的跨平台媒体批处理桌面工具。当前 MVP 支持视频批量压缩、图片批量压缩、任务队列、取消与重试、失败日志和输出目录管理。

## 技术栈

- Electron + Vue 3 + TypeScript + Vite
- Tailwind CSS v4 + shadcn-vue 风格组件 + Lucide 图标
- FFmpeg / FFprobe（视频）
- sharp（图片）

## 开发

```bash
pnpm install
pnpm dev
```

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 打包

打包脚本会先将当前平台的 FFmpeg 和 FFprobe 暂存为 `electron-builder` 的外部资源。因此 Windows、macOS 和 Linux 安装包应分别在对应目标平台及架构的构建环境中生成和验证。

```bash
pnpm build:win
pnpm build:mac
pnpm build:linux
```

正式分发前请阅读 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，并确认 FFmpeg 静态构建及 libx264 的许可证要求。
