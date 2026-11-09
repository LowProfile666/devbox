/**
 * 收藏（原「置顶」）状态：跨桌面布局、主页等多个视图共享。
 *
 * 放在模块层而不是组件里：侧边栏的星标按钮和主页的收藏栏都要读写同一份状态，
 * 组件各自持有会互相失步。持久化在 localStorage，重启保留。
 */
import { computed, ref } from 'vue'
import { storage } from '../host'
import { toolMap, type Tool } from './tools'

const KEY = 'devbox.favorites'

function load(): string[] {
  try {
    const raw = storage.get(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((code) => toolMap.has(code)) : []
  } catch {
    return []
  }
}

/** 收藏的工具 code，按收藏顺序 */
export const favoriteCodes = ref<string[]>(load())

export function isFavorite(code: string): boolean {
  return favoriteCodes.value.includes(code)
}

export function toggleFavorite(code: string): void {
  const idx = favoriteCodes.value.indexOf(code)
  if (idx === -1) {
    favoriteCodes.value.push(code)
  } else {
    favoriteCodes.value.splice(idx, 1)
  }
  storage.set(KEY, JSON.stringify(favoriteCodes.value))
}

/** 收藏区展示的工具列表 */
export const favoriteTools = computed<Tool[]>(() =>
  favoriteCodes.value.map((code) => toolMap.get(code)).filter((t): t is Tool => !!t)
)

/** 组件侧的组合式入口 */
export function useFavorites() {
  return { favoriteCodes, favoriteTools, isFavorite, toggleFavorite }
}
