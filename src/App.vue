<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { ElMessage } from 'element-plus'
import DesktopLayout from './toolbox/DesktopLayout.vue'
import HomePage from './toolbox/HomePage.vue'
import SettingsPanel from './toolbox/SettingsPanel.vue'
import { toolMap, type Tool } from './toolbox/tools'
import { emitToolEnter } from './toolbox/enterBus'
import { quickActions } from './toolbox/quickActions'
import { quickQrCapture, quickQrReadClipboard, type QrQuickResult } from './toolbox/qrcodeQuick'
import { favoriteTools } from './toolbox/favorites'
import { copyToClipboard, notify, showMainWindow, storage } from './host'
import { applyShortcuts, loadShortcuts } from './host/shortcuts'

const layoutRef = ref<InstanceType<typeof DesktopLayout> | null>(null)

// 多标签状态：已开 tab（按打开顺序）+ 当前激活 code（空串 = 显示首页）。
// 'settings' 是虚拟标签：不在 toolMap 里，模板中单独渲染设置页。
const SETTINGS_TAB: Tool = { code: 'settings', explain: '设置', icon: '', component: null as never }
const openTabCodes = ref<string[]>([])
const activeCode = ref('')

// 常用工具：按打开次数统计
const USAGE_KEY = 'devbox.toolUsage'
const FREQ_LIMIT = 8
const usageCounts = ref<Record<string, number>>({})

function loadUsage() {
  try {
    const raw = storage.get(USAGE_KEY)
    if (raw) usageCounts.value = JSON.parse(raw) || {}
  } catch {
    // 存储损坏时按空数据重新统计
  }
}

function persistUsage() {
  storage.set(USAGE_KEY, JSON.stringify(usageCounts.value))
}

watch(usageCounts, persistUsage, { deep: true })

// 次数相同时按工具注册顺序稳定排序
const toolOrder = new Map([...toolMap.keys()].map((code, i) => [code, i]))

const frequentTools = computed<Tool[]>(() =>
  Object.entries(usageCounts.value)
    .filter(([code, count]) => count > 0 && toolMap.has(code))
    .sort(
      (a, b) =>
        (b[1] as number) - (a[1] as number) ||
        (toolOrder.get(a[0]) ?? 0) - (toolOrder.get(b[0]) ?? 0)
    )
    .slice(0, FREQ_LIMIT)
    .map(([code]) => toolMap.get(code) as Tool)
)

const openTabs = computed<Tool[]>(() =>
  openTabCodes.value
    .map((code) => (code === 'settings' ? SETTINGS_TAB : toolMap.get(code)))
    .filter((t): t is Tool => !!t)
)

const activeTool = computed(() => toolMap.get(activeCode.value) ?? null)

/**
 * 打开工具：未开则新开标签，已开则激活。
 * 打开后通过事件总线把「进入动作」广播给工具组件——像随机文案这类工具需要在被
 * 打开时刷新一条内容，它们订阅的是总线而不是 App 状态。
 * 'settings' 是虚拟标签：只切视图，不计入常用统计、不广播进入事件。
 */
function openTab(code: string) {
  // 空串 = 回主页（主页 tab 常驻，不占标签数组）
  if (code === '') {
    activeCode.value = ''
    return
  }
  if (code !== 'settings' && !toolMap.has(code)) return
  if (!openTabCodes.value.includes(code)) {
    openTabCodes.value.push(code)
  }
  activeCode.value = code
  if (code === 'settings') return
  usageCounts.value[code] = (usageCounts.value[code] || 0) + 1

  // 等组件挂载完成再广播，否则首次打开时会错过本次事件
  nextTick(() => emitToolEnter({ code }))
}

/** 关闭标签：关的是当前页时激活右侧邻位（末尾则左侧），全部关完回到首页 */
function closeTab(code: string) {
  const idx = openTabCodes.value.indexOf(code)
  if (idx === -1) return
  openTabCodes.value.splice(idx, 1)
  if (activeCode.value !== code) return
  const next = openTabCodes.value[idx] || openTabCodes.value[idx - 1]
  activeCode.value = next ?? ''
}

/** 关闭全部标签，回到首页 */
function closeAllTabs() {
  openTabCodes.value = []
  activeCode.value = ''
}

/** 关闭其他标签：只保留指定标签，并把它激活 */
function closeOtherTabs(code: string) {
  openTabCodes.value = openTabCodes.value.includes(code) ? [code] : []
  activeCode.value = openTabCodes.value.includes(code) ? code : ''
}

/** 关闭指定标签左侧的所有标签；当前激活页被关掉时切到该标签 */
function closeLeftTabs(code: string) {
  const idx = openTabCodes.value.indexOf(code)
  if (idx === -1) return
  openTabCodes.value = openTabCodes.value.slice(idx)
  if (!openTabCodes.value.includes(activeCode.value)) activeCode.value = code
}

/** 关闭指定标签右侧的所有标签；当前激活页被关掉时切到该标签 */
function closeRightTabs(code: string) {
  const idx = openTabCodes.value.indexOf(code)
  if (idx === -1) return
  openTabCodes.value = openTabCodes.value.slice(0, idx + 1)
  if (!openTabCodes.value.includes(activeCode.value)) activeCode.value = code
}

/** 应用内快捷键：Ctrl+, 打开设置标签页 */
function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    openTab('settings')
  }
}

const unlisteners: UnlistenFn[] = []

onMounted(async () => {
  loadUsage()
  // 启动时把保存的快捷键下发给 Rust；失败条目在设置面板里会提示，这里静默
  void applyShortcuts(loadShortcuts())

  // 全局快捷键唤起主窗后，Rust 广播 app-shown，把光标放进搜索框
  unlisteners.push(
    await listen('app-shown', () => {
      layoutRef.value?.focusSearch()
    })
  )

  // Rust 侧捕获到「工具直达」快捷键时派发，payload 是工具 code
  unlisteners.push(
    await listen<string>('shortcut-tool', (event) => {
      if (event.payload) openTab(event.payload)
    })
  )

  // 「快捷复制 / 复制并粘贴 / 二维码识别」快捷键：Rust 不弹窗，直接派发动作过来。
  // 复制/粘贴在后台完成；二维码动作完成后自动打开二维码标签展示结果。
  // 成功时静默（不打断当前操作）；失败才用系统通知告知。
  unlisteners.push(
    await listen<{ kind: string; code: string }>('shortcut-action', async (event) => {
      const { kind, code } = event.payload
      try {
        if (kind === 'qrcapture') {
          // 截图识别：调起系统截图框选，识别完成回软件展示；取消时窗口保持隐藏
          const result = await quickQrCapture()
          if (result) openQrResult(result)
          return
        }
        if (kind === 'qrread') {
          // 从剪贴板识别：没图也把窗口带回二维码页并提示
          const result = await quickQrReadClipboard()
          if (result === 'empty') {
            openQrResult(null)
            ElMessage.warning('剪贴板中没有图片，请先截图')
          } else {
            openQrResult(result)
          }
          return
        }
        const action = quickActions[code]
        if (!action) return
        const result = await action()
        if (!result) return
        await copyToClipboard(result)
        if (kind === 'paste') {
          await invoke('paste_clipboard')
        }
      } catch {
        void notify('快捷动作失败：执行出错')
      }
    })
  )

  /** 二维码快捷动作的结果落地：打开/激活二维码标签，把图片和解码文本带给组件 */
  function openQrResult(result: QrQuickResult | null) {
    if (!result) void showMainWindow()
    openTab('qrcode')
    nextTick(() => emitToolEnter({ code: 'qrcode', payload: result ?? undefined }))
  }

  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  unlisteners.forEach((off) => off())
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <DesktopLayout
    ref="layoutRef"
    :tabs="openTabs"
    :active-code="activeCode"
    @select="openTab"
    @close="closeTab"
    @close-all="closeAllTabs"
    @close-others="closeOtherTabs"
    @close-left="closeLeftTabs"
    @close-right="closeRightTabs"
    @open-settings="openTab('settings')"
  >
    <!-- KeepAlive 让切走再切回的工具保留输入内容；:key 保证不同工具不复用同一个组件实例 -->
    <KeepAlive>
      <component v-if="activeTool" :is="activeTool.component" :key="activeCode" />
    </KeepAlive>
    <SettingsPanel v-if="activeCode === 'settings'" />
    <HomePage
      v-if="!activeTool && activeCode !== 'settings'"
      :frequent="frequentTools"
      :favorites="favoriteTools"
      @select="openTab"
    />
  </DesktopLayout>
</template>
