/**
 * 主题：跟随系统 / 浅色 / 深色。
 *
 * 实现方式：给 <html> 加 `dark` 类。
 *  - 我们自己的 CSS 变量定义在 `html.dark` 下
 *  - Element Plus 的暗色变量也是认 `html.dark`，两边一次切换同时生效
 */
import { ref } from 'vue'
import { storage } from './index'

export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = 'devbox.theme'

function loadMode(): ThemeMode {
  const raw = storage.get(KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export const themeMode = ref<ThemeMode>(loadMode())
/** 当前实际是否为暗色（供图标切换用，跟随系统时也会更新） */
export const isDark = ref(false)

const media = window.matchMedia('(prefers-color-scheme: dark)')

function applyResolved() {
  const dark =
    themeMode.value === 'dark' || (themeMode.value === 'system' && media.matches)
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

export function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
  storage.set(KEY, mode)
  applyResolved()
}

/** 主题切换用的快捷操作：当前暗色就切到浅色，反之切到深色 */
export function toggleTheme(): void {
  setThemeMode(isDark.value ? 'light' : 'dark')
}

/** 应用启动时调用一次：落地初始主题，并监听系统主题变化 */
export function initTheme(): void {
  applyResolved()
  media.addEventListener('change', () => {
    // 只有「跟随系统」时才响应系统切换，用户显式选了浅/深就保持不动
    if (themeMode.value === 'system') applyResolved()
  })
}
