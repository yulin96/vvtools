# VVTools

VVTools 是一款公司内部使用的跨平台媒体批处理桌面工具。当前支持视频批量压缩、图片批量压缩、音频转换与提取、任务队列、取消与重试、失败日志和输出目录管理。

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

## 版本发布与自动更新

向 `main` 推送 `v*` 标签后，[`.github/workflows/release.yml`](./.github/workflows/release.yml)
会分别构建 macOS ARM64、macOS x64、Windows x64 和 Linux x64 安装包，随后创建
GitHub Release，并将安装包与更新元数据上传到 OSS。Windows 和 Linux 从 OSS/CDN 检查、
下载并安装新版本；当前 macOS 包未签名，因此应用只检查新版本并打开对应架构的 OSS
DMG 下载地址。

日常开发把用户可见的功能、界面、行为、兼容性或缺陷修复写入
[`release-notes.md`](./release-notes.md) 顶部的 `未发布` 章节。发布时执行：

```bash
pnpm release patch
pnpm release minor
pnpm release major
pnpm release 0.1.0
```

该命令要求工作区干净、本地 `main` 与 `origin/main` 一致；它会更新版本号、归档当前更新
日志、运行 typecheck/lint/test、提交、创建带注释的标签，并原子推送分支和标签。Action
只把目标版本的日志写入应用、更新元数据和 GitHub Release，不会发布完整历史。

### OSS 更新配置

在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 中配置：

- Secrets：`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`。
- Variables：`OSS_BUCKET`、`OSS_REGION`、`OSS_RELEASE_PREFIX`、
  `VVTOOLS_UPDATE_BASE_URL`。
- 可选 Variable：使用自定义或内网 Endpoint 时配置 `OSS_ENDPOINT`。

`VVTOOLS_UPDATE_BASE_URL` 必须是终端用户可匿名访问的 HTTPS 地址，且它的路径必须与
`OSS_RELEASE_PREFIX` 指向同一目录。例如：

```text
OSS_RELEASE_PREFIX=vvtools/releases
VVTOOLS_UPDATE_BASE_URL=https://download.example.com/vvtools/releases
```

OSS Bucket 或绑定的 CDN 域名需要允许匿名 `GET`/`HEAD`，并正确处理 Range 请求。更新清单
会使用 5 分钟缓存，带版本号的安装包会使用长期不可变缓存。若域名开启 CDN，请不要为
`latest.json`、`latest.yml` 和 `latest-linux.yml` 设置长期缓存。

建议为 Action 单独创建 RAM 用户，并将写权限限制到发布前缀：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject", "oss:AbortMultipartUpload", "oss:ListParts"],
      "Resource": ["acs:oss:*:*:<bucket>/<release-prefix>/*"]
    }
  ]
}
```

将 `<bucket>` 和 `<release-prefix>` 替换为实际值。应用的更新请求来自 Electron 主进程和
原生 updater，不需要浏览器 CORS；如果 Bucket 保持私有，需要通过带回源鉴权的 CDN
向用户公开下载地址。

本地执行打包命令时也必须提供 `VVTOOLS_UPDATE_BASE_URL`：

```bash
VVTOOLS_UPDATE_BASE_URL=https://download.example.com/vvtools/releases pnpm build:mac
```

GitHub Release 仍使用仓库内置的 `GITHUB_TOKEN`，无需额外 Token。正式对外分发前仍建议
配置 macOS Developer ID 签名与公证、Windows 代码签名，否则 Gatekeeper 和 SmartScreen
可能提示风险。完成 macOS 签名后，还需要把当前“跳转下载”策略切换为应用内下载安装。
