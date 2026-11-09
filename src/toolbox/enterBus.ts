/**
 * 工具进入事件总线：App.vue 打开或激活某个工具后，把「进入动作」广播给工具组件。
 *
 * 为什么需要它：工具组件包在 KeepAlive 里，且是 openTab 之后才挂载的——组件自己在
 * setup 阶段订阅会错过本次进入。由 App.vue 在 nextTick 后统一广播，工具订阅总线
 * 就能稳定收到每次进入。
 */
interface EnterAction {
  /** 工具 code，与 toolbox/tools.ts 的注册键一致 */
  code?: string
  /** 预留：以后从全局快捷键带入的上下文（比如预填内容） */
  payload?: unknown
}

type EnterHandler = (action?: EnterAction) => void

const handlers = new Set<EnterHandler>()

export function onToolEnter(handler: EnterHandler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function emitToolEnter(action?: EnterAction): void {
  handlers.forEach((handler) => handler(action))
}
