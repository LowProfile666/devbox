# 开发百宝箱 · 桌面版

独立的 Windows 桌面工具箱（Tauri 2 + Vue 3 + Element Plus）。与 ZTools 插件版各维护一份代码，没有代码依赖、也不需要安装 ZTools 才能运行。

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 壳 | Tauri 2 (Rust) | 窗口、托盘、全局快捷键 |
| UI | Vue 3 + Vite + Element Plus | 16 个开发小工具 |
| 渲染 | WebView2（系统自带） | 不打包 Chromium，安装包 3-5 MB |

## 目录结构

```
devbox-app/
├── src/
│   ├── App.vue                 # 标签页状态 + 事件订阅
│   ├── main.ts                 # 入口：主题、Element Plus
│   ├── host/index.ts           # 系统能力层（剪贴板/通知/存储/窗口）
│   ├── toolbox/
│   │   ├── DesktopLayout.vue   # 标题栏 / 侧边栏 / 标签条 / 状态栏
│   │   ├── HomePage.vue        # 首页（常用 + 分类卡片）
│   │   ├── tools.ts            # 工具注册表
│   │   └── enterBus.ts         # 进入事件总线
│   └── tools/                  # 16 个工具
└── src-tauri/
    ├── src/lib.rs              # 托盘、全局快捷键、关窗收托盘
    ├── tauri.conf.json         # 窗口与打包配置
    └── capabilities/default.json # 前端可用能力声明
```

## 分层约定

- **工具组件**只依赖 `src/host/index.ts`，不直接 import Tauri API。换壳或补单测时只动这一层。
- **`src-tauri`** 只管原生能力（窗口/托盘/快捷键），业务逻辑一律留在前端，Rust 侧不写业务。
- 新增系统能力时的顺序：`src-tauri` 加插件 → `capabilities/default.json` 授权 → `src/host` 包一层给工具用。

## 首次运行

```bash
npm install
npx tauri icon app-icon.png   # 用 app-icon.png 生成全套图标到 src-tauri/icons/
npm run tauri dev
```

## 打包

```bash
npm run tauri build
# 产物：src-tauri/target/release/bundle/nsis/*.exe
```

## 已实现

- 无边框自绘标题栏（拖拽移动、双击最大化、最小化/最大化/关闭）
- 侧边栏分类导航 + 标签页多开 + 常用工具统计（localStorage）
- 标题栏搜索：输入关键字回车直达工具
- 设置面板（`Ctrl+,` 或标题栏滑块图标）：
  - 主题三档：跟随系统 / 浅色 / 深色（标题栏也有快捷切换按钮）
  - 全局快捷键可录制：唤起/隐藏主窗口 + 任意数量「工具直达」组合键
  - 快捷键保存在本地并在 Rust 侧注册，窗口隐藏时同样可靠；被占用时会提示
- 托盘常驻：左键唤起、右键菜单（显示/退出）；点 ✕ 收进托盘不退出
- 工具内容自适应窗口宽度（不再受插件版 800px 窗口的窄栏限制）

## 快捷键说明

| 项 | 默认 | 说明 |
|---|---|---|
| 唤起 / 隐藏 | `Alt+Space` | 主窗口在前台时收起，否则唤起并聚焦搜索框 |
| 工具直达 | 无 | 在设置里添加，例如 `Alt+J` 直达 JSON 工具 |
| 打开设置 | `Ctrl+,` | 应用内快捷键，不走系统注册 |

- 录制方式：点输入框后直接按组合键；按 `退格` 清空；必须带至少一个修饰键（Ctrl/Alt/Shift/Super）。
- 注册全部在 Rust 侧完成（`invoke('set_shortcuts')`），WebView 隐藏时也不会漏事件。

## 与插件版的刻意差异

| 场景 | 插件版 | 桌面版 | 原因 |
|---|---|---|---|
| 二维码截图解码 | 宿主截图 API | 无此入口，改用粘贴（Ctrl+V）或选文件 | 桌面端未接截屏能力，留待后续用 Rust 补 |
| 一言「粘贴到表单」 | 宿主原子操作（藏窗+粘贴） | 只复制到剪贴板 | 模拟按键需要额外依赖与权限 |
| 打开工具时是否自动复制 | 快捷键进入可按配置自动复制 | 只刷新展示 | 桌面版点标签页是浏览行为，不该静默改写剪贴板 |
| 启动指令路由 | feature code | 标签页 / 搜索 | 桌面版没有指令概念 |

## 后续计划

1. 截图能力（Rust 侧截屏），补回二维码的屏幕取图
2. 自动更新（`tauri-plugin-updater`）
3. 快捷键冲突预检（录制时即提示已被占用）
