/**
 * 二维码的全局快捷动作：截图识别 / 从剪贴板识别。
 *
 * 为什么放模块层而不是组件里：快捷键触发时二维码工具的组件可能根本没挂载。
 * 这里只负责「拿到图片 → 解码」，返回结果后由 App.vue 打开工具标签并把结果
 * 通过 enterBus 广播给组件展示。
 */
import { invoke } from '@tauri-apps/api/core'
import jsQR from 'jsqr'
import { hideWindow, readClipboardImage, showMainWindow, type ClipboardImage } from '../host'

export interface QrQuickResult {
  /** 截图/识别的图片 dataURL，供组件里展示预览 */
  image: string
  /** 解码出的文本；空串表示没识别出二维码 */
  text: string
}

/** RGBA 像素画到画布后用 jsQR 解码；失败返回 null */
function decodeRgba(img: ClipboardImage): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height)
  const code = jsQR(data.data, data.width, data.height)
  return code?.data || null
}

function toDataUrl(img: ClipboardImage): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
  return canvas.toDataURL('image/png')
}

/** 给剪贴板图片算指纹：宽高 + 首尾像素，用来判断「出现了新截图」 */
function imageSignature(img: ClipboardImage | null): string {
  if (!img) return 'none'
  const head = Array.from(img.rgba.slice(0, 32)).join(',')
  const tail = Array.from(img.rgba.slice(-32)).join(',')
  return `${img.width}x${img.height}:${img.rgba.length}:${head}:${tail}`
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询剪贴板等新图出现，最长 60 秒；超时/用户取消返回 null */
async function pollNewImage(prevSig: string): Promise<ClipboardImage | null> {
  for (let i = 0; i < 120; i++) {
    await delay(500)
    const img = await readClipboardImage()
    if (img && imageSignature(img) !== prevSig) return img
  }
  return null
}

/**
 * 快捷键「截图识别」：藏起窗口 → 调起系统截图框选 → 等截图进剪贴板 → 解码
 * → 恢复窗口。返回 null 表示用户取消了截图（窗口保持隐藏，不打扰）。
 */
export async function quickQrCapture(): Promise<QrQuickResult | null> {
  const prevSig = imageSignature(await readClipboardImage())
  await hideWindow()
  await delay(400)
  await invoke('launch_screen_capture')
  const img = await pollNewImage(prevSig)
  if (!img) return null
  const text = decodeRgba(img)
  await showMainWindow()
  return { image: toDataUrl(img), text: text ?? '' }
}

/**
 * 快捷键「从剪贴板识别」：直接读剪贴板图片解码后恢复窗口。
 * 返回 'empty' 表示剪贴板里没有图片。
 */
export async function quickQrReadClipboard(): Promise<QrQuickResult | 'empty'> {
  const img = await readClipboardImage()
  if (!img) return 'empty'
  const text = decodeRgba(img)
  await showMainWindow()
  return { image: toDataUrl(img), text: text ?? '' }
}
