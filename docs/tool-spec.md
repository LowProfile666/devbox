# 创建工具规范

本规范约束 devbox-app 中所有工具（`src/tools/<code>/index.vue`）的创建与改造。
「快捷键后台功能」「配置持久化」不是可选项，而是每个新工具创建时必须先考虑的契约。

## 一、术语与架构

- **工具 code**：工具的全局唯一标识（`toolbox/tools.ts` 的注册键）。code 一经发布不可改名——它是快捷键动作 id、配置存储 key 的组成部分。
- **配置 Schema**：工具的可配置项集中声明在 `toolbox/toolSettings.ts` 的 `toolSchemas` 里（字段名 + 默认值）。页面 UI 与快捷键后台动作通过 `useToolSettings(code)` 拿到**同一个响应式对象**，改动自动持久化到 `devbox.<code>.settings`。
- **快捷动作**：适合后台触发的工具在 `toolbox/quickActions.ts` 注册生成函数，动作分三类：打开工具（`tool:`）、复制结果（`copy:`）、复制并粘贴（`paste:`），另有独立功能类动作（如二维码的 `qrcapture:`）。

## 二、创建清单（8 项）

新工具按顺序过一遍，全部满足才算完成：

| # | 维度 | 要求 |
|---|------|------|
| 1 | 注册 | 在 `toolbox/tools.ts` 按分类登记 `code / explain / component`；code 用小写英文，见名知义 |
| 2 | 配置 Schema | 可配置项（长度、开关、范围、选项……）先在 `toolSchemas` 声明字段+默认值，组件用 `useToolSettings` 读写。**禁止**在组件里用独立 `ref` 存配置。输出结果（生成的密码/数字等）不是配置，不进 schema |
| 3 | 快捷键预留 | 判断该工具是否有「一按就出结果」的语义（随机类、生成类通常有）。有则在 `quickActions` 注册生成函数，**必须通过 `useToolSettings` 读同一份配置**，禁止硬编码默认值。无则只保留「打开工具」一种动作（默认具备，无需额外代码） |
| 4 | 进入事件 | 每次打开需要刷新内容的（随机文案/颜色类）订阅 `onToolEnter`；普通工具忽略 |
| 5 | KeepAlive 兼容 | 组件被 KeepAlive 缓存，全局事件监听（paste、keydown 等）必须 `onActivated` 挂载 / `onDeactivated` 卸载，成对出现（二维码工具的 paste 监听是范例） |
| 6 | 主题适配 | 样式只用 `main.css` 定义的 CSS 变量；禁写死主题色。允许的例外：语法高亮调色板、Element Plus 状态色、rgba 色调 |
| 7 | 系统能力 | 剪贴板、通知、窗口操作一律经 `src/host/index.ts` 封装调用，组件不直接 import Tauri API |
| 8 | 反馈与兜底 | 复制/失败有 ElMessage 反馈；网络类工具必须有离线兜底（随机文案的句池是范例）；大输出做尺寸/数量限制 |

## 三、代码约定

- 组件结构统一 `script setup + template + scoped style`。
- 复用逻辑提取到 `src/toolbox/`（如 `quickActions` / `qrcodeQuick` / `enterBus` / `favorites` / `toolSettings`）。
- 系统能力一律经 `src/host/index.ts`，保持「换壳只改一个文件」的能力。
- 配置字段的类型由 schema 默认值推导（TS），改默认值即改类型。

## 四、使用 toolSettings 的最小示例

```ts
// 1. toolbox/toolSettings.ts 的 toolSchemas 里声明：
export const toolSchemas = {
  mytool: { mode: 'fast', retries: 3 },
}

// 2. 组件里读写（自动持久化）：
const settings = useToolSettings('mytool')
// settings.mode / settings.retries 直接 v-model 到 UI

// 3. quickActions 里后台生成时读同一份：
const s = useToolSettings('mytool')
generateWith(s.retries)
```

## 五、快捷动作的时序注意（模拟按键）

「复制并粘贴」在 Rust 侧向当前聚焦应用注入 Ctrl+V。两个已知坑（均已处理，新改动勿回退）：

1. **等物理修饰键释放**：全局热键在按下瞬间触发，注入前必须等用户松开 Ctrl/Alt（`GetAsyncKeyState` 轮询），否则注入的 V 变成 Ctrl+Alt+V。
2. **不要用 `Key::Unicode`**：Unicode 走 VK_PACKET 注入，`Ctrl+VK_PACKET` 在很多应用不生效；必须用映射真实虚拟键码的 `Key::V`。

## 六、验收清单

- [ ] 改配置 → 重启软件 → 配置保持
- [ ] 改配置 → 不打开窗口直接按快捷键 → 结果与新配置一致
- [ ] 暗色模式下无白色块、无不可读文字
- [ ] 切走再切回标签页，输入内容与全局监听行为正常
- [ ] 网络断开时功能不崩，有兜底输出
