---
name: devbox-tool
description: devbox-app（开发百宝箱）的工具创建与改造规范。在本项目中新建、修改工具组件，或涉及工具配置持久化、快捷键后台动作、工具样式时必须遵循。触发词：新工具、创建工具、加个工具、工具配置、快捷键、工具样式、编码规范。
---

# devbox-app 工具编码规范

本规范约束 `src/tools/<code>/index.vue` 下所有工具的创建与改造。核心思想：
**「配置持久化」和「快捷键后台功能」不是可选项，而是新工具创建时必须先考虑的契约。**

## 一、术语与架构

- **工具 code**：全局唯一标识（`toolbox/tools.ts` 注册键）。**一经发布不可改名**——它是快捷键动作 id、配置存储 key 的组成部分。
- **配置 Schema**：可配置项集中声明在 `toolbox/toolSettings.ts` 的 `toolSchemas`（字段名 + 默认值）。页面 UI 与快捷键后台动作通过 `useToolSettings(code)` 拿到**同一个响应式对象**，改动自动持久化到 `devbox.<code>.settings`。
- **快捷动作**：适合后台触发的工具在 `toolbox/quickActions.ts` 注册生成函数。动作类型：打开工具（`tool:`）、复制结果（`copy:`）、复制并粘贴（`paste:`），独立功能用自有前缀（如二维码 `qrcapture:`）。

## 二、创建清单（8 项，全部满足才算完成）

| # | 维度 | 要求 |
|---|------|------|
| 1 | 注册 | `toolbox/tools.ts` 按分类登记 `code / explain / component`；code 小写英文、见名知义 |
| 2 | 配置 Schema | 可配置项（长度、开关、范围、选项）先在 `toolSchemas` 声明字段+默认值，组件用 `useToolSettings` 读写。**禁止**用独立 `ref` 存配置。输出结果（生成的密码/数字）不是配置，不进 schema |
| 3 | 快捷键预留 | 判断是否有「一按就出结果」的语义（随机类、生成类通常有）。有则在 `quickActions` 注册生成函数，**必须经 `useToolSettings` 读同一份配置**，禁止硬编码默认值。无则默认具备「打开工具」动作，无需额外代码 |
| 4 | 进入事件 | 每次打开需要刷新内容的（随机文案/颜色类）订阅 `onToolEnter`；普通工具忽略 |
| 5 | KeepAlive 兼容 | 组件被 KeepAlive 缓存：全局事件监听（paste、keydown 等）必须 `onActivated` 挂载 / `onDeactivated` 卸载，成对出现（二维码工具的 paste 监听是范例） |
| 6 | 主题适配 | 样式只用 `main.css` 的 CSS 变量，禁写死主题色。例外仅三种：语法高亮调色板、Element Plus 状态色（#f56c6c/#67c23a/#e6a23c）、rgba 色调 |
| 7 | 系统能力 | 剪贴板、通知、窗口操作一律经 `src/host/index.ts` 封装调用，组件**不直接 import Tauri API** |
| 8 | 反馈与兜底 | 复制/失败有 ElMessage 反馈；网络类工具必须有离线兜底（随机文案句池是范例）；大输出做尺寸/数量限制 |

## 三、样式规范（一致性优先）

1. **同样的组件必须同样的样式**：同类元素（标题、描述、配置行、结果卡片、按钮行）在所有工具中结构与样式保持一致，除非有特定需求并在注释中说明理由。新工具的页面骨架直接抄既有工具（推荐参考：随机密码的 config/actions/result 结构）。
2. **变量清单**（定义在 `main.css`，禁止写死主题色、禁止 `var(--x, 兜底色)`）：
   - 文字：正文 `--text-primary`，辅助说明 `--text-secondary`
   - 强调色：`--app-accent`（链接、选中、悬停高亮）
   - 面板：容器 `--bg-card`，标题条 `--bg-title`，悬停 `--bg-hover`，页面底色 `--bg-main`，边框 `--border-color`
3. **优先使用 Element Plus 组件**，不要手写重复造轮子：
   - 开关 → `el-switch`；单选 → `el-radio-group/el-radio-button`；多选 → `el-checkbox`
   - 数字输入 → `el-input-number`（带 min/max）；滑杆 → `el-slider`
   - 折叠 → `el-collapse`；对话框 → `el-dialog`；消息 → `ElMessage`（成功 800ms、错误 1000ms）
   - 仅当 EP 覆盖不了（如二维码 canvas、CodeMirror 编辑器）才手写，且样式仍走变量
4. 覆写 EP 内部样式用 `:deep()`，并优先改 CSS 变量（如 `--el-collapse-border-color`）而不是堆属性。

## 四、代码约定

- 组件结构统一 `script setup + template + scoped style`。
- 复用逻辑提取到 `src/toolbox/`（`quickActions` / `qrcodeQuick` / `enterBus` / `favorites` / `toolSettings`）。
- 配置字段类型由 schema 默认值推导；改默认值即改类型；字段改名/删除后旧存储数据自动回落默认（load 只合并 schema 声明且类型相符的字段），无需迁移代码。
- **代码注释只标注重点逻辑（为什么、取舍），禁止写文档路径/文档引用类信息。**

## 五、useToolSettings 最小示例

```ts
// 1. toolbox/toolSettings.ts 的 toolSchemas 里声明：
export const toolSchemas = {
  mytool: { mode: 'fast', retries: 3 },
}

// 2. 组件里读写（自动持久化）：
const settings = useToolSettings('mytool')
// settings.mode / settings.retries 直接 v-model 到 UI

// 3. quickActions 后台生成时读同一份配置：
const s = useToolSettings('mytool')
generateWith(s.retries)
```

## 六、快捷动作的时序坑（模拟按键，改动勿回退）

「复制并粘贴」在 Rust 侧向当前聚焦应用注入 Ctrl+V，两个已修复的坑：

1. **等物理修饰键释放**：全局热键在按下瞬间触发，注入前必须等用户松开 Ctrl/Alt（`GetAsyncKeyState` 轮询，超时 1.5s），否则注入的 V 变成 Ctrl+Alt+V——瞬时动作（uuid）必现、有网络延迟的动作（随机文案）侥幸正常。
2. **不要用 `Key::Unicode`**：Unicode 走 VK_PACKET 注入，`Ctrl+VK_PACKET` 在很多应用不被视为 Ctrl+V；必须用映射真实虚拟键码的 `Key::V`。

## 七、协作红线

- **git 操作（commit/reset/push）必须用户明确要求后才能执行**，改动留在工作区即可。
- 后台动作（复制/复制并粘贴/二维码识别）**成功时静默**，失败才提示——不打断用户当前操作。

## 八、验收清单

- [ ] 改配置 → 重启软件 → 配置保持
- [ ] 改配置 → 不打开窗口直接按快捷键 → 结果与新配置一致
- [ ] 暗色模式下无白色块、无不可读文字
- [ ] 切走再切回标签页，输入内容与全局监听行为正常
- [ ] 网络断开时功能不崩，有兜底输出
- [ ] 与既有工具并排打开，同类元素样式观感一致
