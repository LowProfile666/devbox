/**
 * 工具配置 Schema 架构 —— 「创建工具规范」第 2/3 条的实现。
 *
 * 核心思想：每个工具在这里**声明**自己的配置字段和默认值（toolSchemas），
 * 页面 UI 和快捷键后台动作通过 useToolSettings 拿到**同一个响应式对象**：
 *   - 页面改配置 → 自动持久化到 localStorage（key: devbox.<code>.settings）
 *   - 快捷键后台生成 → 读同一份配置，与页面所见即所得
 * 消灭了「页面一套配置、快捷键一套硬编码默认值」的两张皮问题。
 *
 * 约定：
 *  - 新工具需要配置时，先在 toolSchemas 里声明字段，再用 useToolSettings 接入
 *  - 只合并 schema 里声明的字段；saved 里的多余/类型不符字段会被忽略（改字段名
 *    或删字段时旧数据自动失效，回落默认值，不需要迁移）
 *  - 输出结果（生成的密码/数字等）不属于配置，不进 schema
 */
import { reactive, watch } from 'vue'
import { storage } from '../host'

/** 各工具的配置 Schema：字段名 -> 默认值。类型由这里推导，改默认值即改类型 */
export const toolSchemas = {
  /** 随机密码 */
  password: {
    length: 16,
    useUpper: true,
    useLower: true,
    useDigit: true,
    useSymbol: true,
  },
  /** 随机数字 */
  number: {
    min: 1,
    max: 100,
    count: 1,
    decimalPlaces: 0,
  },
  /** 随机文案 */
  randomtext: {
    source: 'poem' as 'poem' | 'hitokoto',
    hitokotoCats: ['d', 'i', 'k'] as string[],
  },
  // uuid / color 等无可配置项的工具不声明，快捷键动作用固定生成逻辑
} satisfies Record<string, Record<string, unknown>>

export type ToolSettingsCode = keyof typeof toolSchemas & string

type SettingsOf<K extends ToolSettingsCode> = typeof toolSchemas[K]

const cache = new Map<string, ReturnType<typeof reactive>>

function settingsKey(code: string): string {
  return `devbox.${code}.settings`
}

function loadMerged<K extends ToolSettingsCode>(code: K): SettingsOf<K> {
  const defaults = toolSchemas[code]
  let saved: Record<string, unknown> = {}
  try {
    const raw = storage.get(settingsKey(code))
    if (raw) saved = JSON.parse(raw) || {}
  } catch {
    // 存储损坏时整体回落默认值
  }
  const merged: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const savedValue = saved[key]
    // 类型不符的字段忽略（比如 schema 从 string 改成 number 的历史残留）
    if (typeof savedValue === typeof (defaults as Record<string, unknown>)[key]) {
      merged[key] = savedValue
    }
  }
  return merged as SettingsOf<K>
}

/**
 * 取某个工具的配置（响应式对象，全应用单例）。
 * 页面组件直接 v-model 它的字段；quickActions 读它来生成结果。
 * 首次调用时从 storage 加载并与 schema 默认值合并，之后任意字段变更自动持久化。
 */
export function useToolSettings<K extends ToolSettingsCode>(code: K): SettingsOf<K> {
  let settings = cache.get(code)
  if (!settings) {
    settings = reactive(loadMerged(code))
    watch(
      settings,
      () => storage.set(settingsKey(code), JSON.stringify({ ...settings })),
      { deep: true }
    )
    cache.set(code, settings)
  }
  return settings as SettingsOf<K>
}
