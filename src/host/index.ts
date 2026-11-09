/**
 * 桌面能力层。
 *
 * 工具组件只通过这里调用系统能力，不直接 import Tauri API。这样做的两个理由：
 *  1. 换壳或换实现时只改这一个文件
 *  2. 想在没有窗口环境的地方跑单测时，可以整个模块打桩
 */
import { readImage, writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 写文本到系统剪贴板。失败时 reject，由调用方决定怎么提示用户 */
export function copyToClipboard(text: string): Promise<void> {
  return writeText(text)
}

export interface ClipboardImage {
  rgba: Uint8Array
  width: number
  height: number
}

/**
 * 读取系统剪贴板里的图片（截图工具 Win+Shift+S 截完就在剪贴板里）。
 * 没有图片或权限不足时返回 null，由调用方提示。
 */
export async function readClipboardImage(): Promise<ClipboardImage | null> {
  try {
    const image = await readImage()
    const rgba = await image.rgba()
    const size = await image.size()
    return { rgba, width: size.width, height: size.height }
  } catch {
    return null
  }
}

/**
 * 发系统通知。
 * 首次使用会触发系统授权弹窗；用户拒绝时静默跳过——通知只是辅助反馈。
 */
export async function notify(body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      granted = (await requestPermission()) === 'granted'
    }
    if (granted) {
      sendNotification({ title: '开发百宝箱', body })
    }
  } catch {
    // 通知失败不影响主流程
  }
}

/**
 * 键值存储。
 * 底层是 WebView2 的 localStorage，按应用数据目录持久化；值统一按字符串存，
 * 结构化数据由调用方自己 JSON 序列化，避免隐式转换带来的兼容问题。
 */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // 配额写满等异常不影响功能
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // 同上
    }
  },
}

/** 收起主窗口（留在托盘里，不走退出流程） */
export function hideWindow(): Promise<void> {
  return getCurrentWindow().hide()
}

/** 显示并聚焦主窗口（比如截图识别完成后回来看结果） */
export async function showMainWindow(): Promise<void> {
  const win = getCurrentWindow()
  await win.show()
  await win.setFocus()
}
