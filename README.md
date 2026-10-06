# VVTools

VVTools 是一款面向公开用户的跨平台桌面文件批处理工具，支持视频、图片、音频、PDF、字体处理和批量重命名，以及任务队列、取消与重试、失败日志和输出目录管理。

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

## 系统入口与快捷动作

在「设置 → 系统入口与快捷动作」中启用文件右键入口，并管理动作名称、顺序和独立图片参数。快捷处理复用应用任务队列，保留原文件；同名输出可自动改名或跳过。

- 应用菜单提供「文件 → 添加文件 / 快捷处理」、工作区切换和设置入口，支持 Cmd/Ctrl+O 添加文件、Cmd/Ctrl+, 打开设置、Cmd/Ctrl+1–7 切换工作区。macOS 使用屏幕左上角的应用菜单，Windows 可按 Alt 显示窗口菜单；两个平台均不创建托盘或状态栏图标。
- Finder 快速操作安装后，如未出现，可在「键盘 → 键盘快捷键 → 服务」中启用。卸载 macOS 应用前关闭 Finder 快速操作，以移除已安装的工作流。
- Windows 文件右键使用经典菜单，Windows 11 从「显示更多选项」进入；后台快捷任务可发送完成通知，重新打开应用可查看当前批次。
- 文件右键需要安装版；开发模式不注册系统入口。Windows 打包前的 `pnpm stage:desktop` 需要 Visual Studio C++ Build Tools，原生发布工作流会执行这一步。

## 图标维护

运行 `pnpm icons` 从 `build/logo-source.png` 和 `build/logo-source-dark.png` 生成程序的浅色、深色图标，从 `build/logo-mark-source.png` 生成应用内透明图标，也可通过三个位置参数分别指定对应源文件。源文件是至少 1024 × 1024 的正方形图像；程序图标带完整底色，脚本统一处理圆角，并分别添加 macOS 和 Windows 的透明留白，避免重复套底框或重复缩小。内容图标必须有透明背景，导出时裁去外围空白并保留透明通道。

Windows 使用包含 16、20、24、32、40、48、64、96、128、256 px 的 ICO；macOS 使用包含 16–1024 px 普通与 Retina 图像的 ICNS，ICNS 需在 macOS 上生成，运行中的 Dock 使用 1024 px PNG 保留高分辨率。界面侧栏使用独立的 256 px 图标，避免系统图标的外部留白使其显示过小。

侧栏和关于面板统一使用透明图标。运行中的 Dock / 窗口图标使用现有主题设置；选择“跟随系统”时自动切换。安装包、Finder 和桌面快捷方式仍使用固定的浅色程序图标，ICNS / ICO 本身不负责动态主题切换。

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
GitHub Release。安装包、blockmap 和更新清单均由 GitHub Releases 提供，不再上传到 OSS。
Windows NSIS 和 Linux AppImage 可在应用内检查、下载和安装更新；macOS 当前使用 Ad-hoc
签名，检查更新后会打开对应版本、对应架构的 GitHub DMG，下载后手动替换应用。
macOS ARM64/x64 的文件信息合并到同一份 `latest-mac.yml`，并保留架构清单与 Homebrew
使用的稳定 DMG 别名。

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

### GitHub 更新配置

更新源已在 `electron-builder.yml` 中配置为公开仓库 `yulin96/vvtools` 的 GitHub provider。
本地打包不再需要 `VVTOOLS_UPDATE_BASE_URL`。发布 Action 使用仓库内置的 `GITHUB_TOKEN`
和 `contents: write` 权限，无需 OSS 密钥、Bucket 或 CDN 配置；应用端无需 GitHub Token。
新 Release 先以草稿上传完整资源，再对外发布。

已安装的旧版本仍内置 OSS 更新地址，无法因仓库配置变化而自动切换；需要从 GitHub
手动安装一次切换后的新版本，之后使用 GitHub 更新。旧 OSS 文件和账号配置不会被发布
流程自动删除，迁移结束后可自行清理；仓库中原有 OSS Secrets/Variables 也可移除。

macOS 当前使用 Ad-hoc 签名，不等同于 Apple Developer ID 签名和公证；直接下载 DMG 时 Gatekeeper 仍可能提示
风险。Homebrew Cask 安装会自动清除自身安装应用的 quarantine 属性，手动安装可执行：

```bash
sudo xattr -r -d com.apple.quarantine /Applications/VVTools.app
```

正式对外分发前仍建议配置 macOS Developer ID 签名与公证、Windows 代码签名。

发布流程会额外生成稳定名称的 `vvtools-latest-arm64.dmg` 和
`vvtools-latest-x64.dmg`，Cask 始终跟随这两个最新版本别名，不需要每次发布后手动修改版本
和校验值。Homebrew 默认不会主动升级 `version :latest` Cask，因此升级时需要使用
`--greedy-latest`。
