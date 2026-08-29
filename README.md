# ScholarReader

ScholarReader 是一款 Windows 优先、本地优先的 PDF 学习阅读器。核心阅读、文件管理、收藏、标签、备注、原文定位与高亮不依赖网络或 AI；解释、翻译、总结是可选增强。

## 功能

- Tauri 2 + React + TypeScript 桌面应用，SQLite 数据库与追加式 Migration。
- PDF.js Canvas Layer、Text Layer、Highlight Layer，支持搜索、缩放、旋转、页码跳转和阅读进度恢复。
- 单个/多个 PDF 与文件夹导入、SHA-256 去重、文件收藏、重命名、系统打开、资源管理器定位和移动后重新绑定。
- 选区悬浮工具栏、离线收藏、标签、备注自动保存、收藏搜索和重复收藏提示。
- 多级 TextLocator：位置、精确文本、上下文、模糊匹配、页码兜底；自动恢复透明高亮。
- 可插拔 OpenAI、Ollama、自定义 OpenAI-compatible Provider；异步请求、超时、取消和连接测试。
- API Key 由 Rust 写入 Windows Credential Manager，不保存到 SQLite，也不传回 React。
- 跟随系统/浅色/深色主题与阅读快捷键。

## 开发

要求 Node.js、pnpm、Rust stable，以及 Windows 上的 WebView2 构建环境。

```powershell
pnpm install
pnpm tauri dev
```

检查与测试：

```powershell
pnpm typecheck
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

Windows 打包：

```powershell
pnpm tauri build
```

## 本地数据

- SQLite：`%LOCALAPPDATA%\com.scholarreader.app\scholar-reader.db`
- AI 密钥：Windows Credential Manager，服务名 `com.scholarreader.app`
- 原 PDF 保留在用户选择的原始位置；ScholarReader 不复制、不编辑、也不删除原 PDF。
- 本地 AI 模型不包含在 Git Repository 中，首次启用本地 AI 时由 ScholarReader 自动下载；构建所需的 llama.cpp runtime 由构建脚本下载并校验。

架构边界、定位置信度和阶段决策见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
