/**
 * 全局快捷键：配置的读写、下发到 Rust、以及键盘事件到快捷键字符串的转换。
 *
 * 为什么注册放在 Rust：窗口隐藏后 WebView 的 JS 回调可能被节流，而 Rust 侧收到的是
 * 系统级 WM_HOTKEY，始终可靠。前端只负责「收集用户按了什么键」，注册和派发都在 Rust。
 */
import { invoke } from '@tauri-apps/api/core'
import { storage } from './index'

const KEY = 'devbox.shortcuts'

export interface ShortcutConfig {
  /** 唤起 / 隐藏主窗口 */
  toggle: string
  /** 工具 code -> 快捷键，直接打开该工具 */
  tools: Record<string, string>
  /** 工具 code -> 快捷键，不打开窗口直接把生成结果复制到剪贴板 */
  copies: Record<string, string>
  /** 工具 code -> 快捷键，复制结果并模拟 Ctrl+V 粘贴到当前应用 */
  pastes: Record<string, string>
  /** 其它功能动作：完整 id（如 `qrcapture:qrcode`）-> 快捷键 */
  actions: Record<string, string>
}

export interface ShortcutEntry {
  /** 'toggle' 或 'tool:<code>' */
  id: string
  accelerator: string
}

export const DEFAULT_CONFIG: ShortcutConfig = {
  toggle: 'Alt+Space',
  tools: {},
  copies: {},
  pastes: {},
  actions: {},
}

export function loadShortcuts(): ShortcutConfig {
  try {
    const raw = storage.get(KEY)
    if (!raw) return { ...DEFAULT_CONFIG, tools: {}, copies: {}, pastes: {}, actions: {} }
    const parsed = JSON.parse(raw)
    const record = (v: unknown): Record<string, string> =>
      v && typeof v === 'object' ? (v as Record<string, string>) : {}
    return {
      toggle: typeof parsed.toggle === 'string' ? parsed.toggle : DEFAULT_CONFIG.toggle,
      tools: record(parsed.tools),
      copies: record(parsed.copies),
      pastes: record(parsed.pastes),
      actions: record(parsed.actions),
    }
  } catch {
    return { ...DEFAULT_CONFIG, tools: {}, copies: {}, pastes: {}, actions: {} }
  }
}

export function saveShortcuts(config: ShortcutConfig): void {
  storage.set(KEY, JSON.stringify(config))
}

/**
 * 把配置下发给 Rust；返回注册失败的 id 列表（快捷键冲突、格式不合法等）。
 * Rust 会先注销全部旧快捷键再逐个注册，所以这里可以整份下发。
 */
export async function applyShortcuts(config: ShortcutConfig): Promise<string[]> {
  const entries: ShortcutEntry[] = []
  if (config.toggle) entries.push({ id: 'toggle', accelerator: config.toggle })
  for (const [code, accelerator] of Object.entries(config.tools)) {
    if (accelerator) entries.push({ id: `tool:${code}`, accelerator })
  }
  for (const [code, accelerator] of Object.entries(config.copies)) {
    if (accelerator) entries.push({ id: `copy:${code}`, accelerator })
  }
  for (const [code, accelerator] of Object.entries(config.pastes)) {
    if (accelerator) entries.push({ id: `paste:${code}`, accelerator })
  }
  for (const [id, accelerator] of Object.entries(config.actions)) {
    if (accelerator) entries.push({ id, accelerator })
  }
  try {
    return await invoke<string[]>('set_shortcuts', { entries })
  } catch (e) {
    console.error('[devbox] 下发快捷键失败', e)
    return entries.map((e) => e.id)
  }
}

// ---------- 键盘事件 -> 快捷键字符串 ----------

/** 特殊键在 Tauri 快捷键语法里的写法 */
const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
}

/**
 * 从键盘事件生成 Tauri 可解析的快捷键字符串，例如 `Ctrl+Alt+K`。
 * 返回 null 表示这次按键不能作为快捷键（只有修饰键，或没有修饰键）。
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')

  const { key } = e
  // 只按了修饰键，不构成组合
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null
  if (!parts.length) return null

  let main: string | null = null
  if (SPECIAL_KEYS[key]) {
    main = SPECIAL_KEYS[key]
  } else if (/^F\d{1,2}$/.test(key)) {
    main = key
  } else if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
    main = key.toUpperCase()
  }
  if (!main) return null

  parts.push(main)
  return parts.join('+')
}

/** 把快捷键字符串显示成更友好的样子（只是展示层，不参与注册） */
export function prettyAccelerator(accelerator: string): string {
  return accelerator.replace(/Ctrl/g, 'Ctrl').replace(/\+/g, ' + ')
}
