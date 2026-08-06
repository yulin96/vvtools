# VVTools

VVTools 是一款面向公开用户的跨平台桌面媒体批处理工具，支持视频、图片、音频、PDF 和字体处理，以及任务队列、取消与重试、失败日志和输出目录管理。

项目代码公开托管于 [GitHub](https://github.com/yulin96/vvtools)，可从
[Releases](https://github.com/yulin96/vvtools/releases) 下载已发布版本。

## 技术栈

- Electron + Vue 3 + TypeScript + Vite
- Tailwind CSS v4 + shadcn-vue 风格组件 + Lucide 图标
- FFmpeg / FFprobe（视频）
- sharp（图片）
- PDFium / qpdf（PDF）
- FontTools / fontkit（字体）

## 开发

```bash
pnpm install
pnpm dev
```

## 使用 Homebrew 安装

添加本仓库作为自定义 Tap，然后安装 VVTools：

```bash
brew tap yulin96/vvtools https://github.com/yulin96/vvtools.git
brew install --cask yulin96/vvtools/vvtools
```

Cask 会自动选择 Apple Silicon 或 Intel 安装包、跟随最新 GitHub Release，并清除已安装
应用的 quarantine 隔离属性。升级时执行：

```bash
brew update
brew upgrade --cask --greedy-latest yulin96/vvtools/vvtools
```

普通卸载会保留本地配置；仅在需要一并清除配置时使用 `--zap`：

```bash
brew uninstall --cask yulin96/vvtools/vvtools
brew uninstall --cask --zap yulin96/vvtools/vvtools
```

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 打包

安装依赖时会下载并校验当前平台固定版本的 FFmpeg 8.1.2 和 FFprobe；打包脚本会将它们暂存为 `electron-builder` 的外部资源。因此 Windows、macOS 和 Linux 安装包应分别在对应目标平台及架构的构建环境中生成和验证。

```bash
pnpm build:win
pnpm build:mac
pnpm build:linux
```

正式分发前请阅读 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，并确认 FFmpeg 静态构建及 libx264 的许可证要求。

## 版本发布与自动更新

向 `main` 推送 `v*` 标签后，[`.github/workflows/release.yml`](./.github/workflows/release.yml)
会分别构建 macOS ARM64、macOS x64、Windows x64 和 Linux x64 安装包，随后创建
GitHub Release，并将安装包与更新元数据上传到 OSS。Windows、macOS 和 Linux 均从
OSS/CDN 检查、下载并安装新版本。macOS 会为 ARM64 和 x64 分别生成 ZIP 更新包、blockmap
及 `latest-mac.yml`，并使用 Ad-hoc 签名；若自动更新失败，可从界面转到 GitHub Release
手动下载 DMG。

日常开发把用户可见的功能、界面、行为、兼容性或缺陷修复写入
[`release-notes.md`](./release-notes.md) 顶部的 `未发布` 章节。发布时执行：

```bash
pnpm release:patch
pnpm release:minor
pnpm release:major
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
`latest.yml`、`latest-mac.yml` 和 `latest-linux.yml` 设置长期缓存。

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

GitHub Release 仍使用仓库内置的 `GITHUB_TOKEN`，无需额外 Token。macOS 当前使用 Ad-hoc
签名，不等同于 Apple Developer ID 签名和公证；直接下载 DMG 时 Gatekeeper 仍可能提示
风险。Homebrew Cask 安装会自动清除自身安装应用的 quarantine 属性，手动安装可执行：

```bash
sudo xattr -r -d com.apple.quarantine /Applications/VVTools.app
```

正式对外分发前仍建议配置 macOS Developer ID 签名与公证、Windows 代码签名。

发布流程会额外生成稳定名称的 `vvtools-latest-arm64.dmg` 和
`vvtools-latest-x64.dmg`，Cask 始终跟随这两个最新版本别名，不需要每次发布后手动修改版本
和校验值。Homebrew 默认不会主动升级 `version :latest` Cask，因此升级时需要使用
`--greedy-latest`。
