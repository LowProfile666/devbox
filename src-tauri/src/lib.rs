use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const MAIN_WINDOW: &str = "main";

/// 自定义数据目录的标记文件名，放在 app_config_dir（跟随 identifier，永远稳定可寻址）
const DATA_DIR_MARKER: &str = "data-dir.txt";

/// 点 ✕（关闭窗口）时的动作：'tray' = 隐藏到托盘，'exit' = 直接退出。
/// 值由前端持久化（localStorage），启动后和修改设置时经 set_close_action 同步给 Rust。
struct CloseAction(Mutex<String>);

/// 快捷键 -> 动作 id（`toggle` / `tool:<code>` / `copy:<code>` / `paste:<code>`）。
///
/// 插件只负责「系统层注册」，它不知道每个快捷键该干什么；这里保存映射，热键回调
/// 触发时反查动作。放在 Rust 侧而不是前端，是为了窗口隐藏时也能可靠响应。
type ShortcutRegistry = Mutex<HashMap<Shortcut, String>>;

#[derive(Deserialize)]
struct ShortcutEntry {
    id: String,
    accelerator: String,
}

/// 「复制 / 复制并粘贴」动作派发给前端的 payload
#[derive(Serialize, Clone)]
struct QuickAction<'a> {
    kind: &'a str,
    code: &'a str,
}

/// 存储位置信息，设置面板展示用
#[derive(Serialize)]
struct StorageInfo {
    /// 当前生效（重启后也生效）的数据目录
    data_dir: String,
    /// 是否为用户自定义目录
    is_custom: bool,
    /// 自定义标记文件的位置
    marker_path: String,
    /// 可安全清理的缓存（Chromium 网络缓存、着色器缓存等）字节数
    cache_bytes: u64,
}

/// 读取自定义数据目录标记；目录不存在时视为无效，回落默认
fn custom_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let marker = app.path().app_config_dir().ok()?.join(DATA_DIR_MARKER);
    let raw = std::fs::read_to_string(marker).ok()?;
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }
    let dir = PathBuf::from(&trimmed);
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

fn marker_path(app: &tauri::AppHandle) -> String {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join(DATA_DIR_MARKER).to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 显示并聚焦主窗口，同时广播 app-shown 让前端把光标放进搜索框。
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit("app-shown", ());
    }
}

/// 快捷键语义：已经在前台就收起，否则唤起。和 uTools / Raycast 的交互一致。
fn toggle_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            show_main(app);
        }
    }
}

/// 用前端传来的配置整份重建快捷键表。
/// 返回注册失败的 id 列表（被其它程序占用、格式不合法），前端据此提示用户。
#[tauri::command]
fn set_shortcuts(
    app: tauri::AppHandle,
    registry: State<'_, ShortcutRegistry>,
    entries: Vec<ShortcutEntry>,
) -> Vec<String> {
    let _ = app.global_shortcut().unregister_all();
    if let Ok(mut map) = registry.lock() {
        map.clear();
    }

    let mut failed = Vec::new();
    for entry in entries {
        let Ok(shortcut) = entry.accelerator.parse::<Shortcut>() else {
            failed.push(entry.id);
            continue;
        };
        match app.global_shortcut().register(shortcut.clone()) {
            Ok(_) => {
                if let Ok(mut map) = registry.lock() {
                    map.insert(shortcut, entry.id);
                }
            }
            Err(err) => {
                eprintln!("[devbox] 快捷键注册失败 {} {}: {err}", entry.id, entry.accelerator);
                failed.push(entry.id);
            }
        }
    }
    failed
}

/// 可安全清理的缓存目录（相对数据目录下的 EBWebView）。不含 Local Storage——那是真实数据。
const CACHE_DIRS: &[&str] = &[
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/DawnCache",
    "Default/DawnGraphiteCache",
    "Default/DawnWebGPUCache",
    "Default/Service Worker/CacheStorage",
    "Default/Service Worker/ScriptCache",
    "GrShaderCache",
    "ShaderCache",
    "GraphiteDawnCache",
];

/// 递归统计目录大小，出错（无权限/被锁）按 0 处理
fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            total += dir_size(&entry.path());
        } else {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    total
}

/// 清理缓存目录，返回清理前统计到的字节数（被锁住删不掉的文件留在原地）
fn clean_cache_dirs(data_dir: &Path) -> u64 {
    let base = data_dir.join("EBWebView");
    let mut freed = 0;
    for rel in CACHE_DIRS {
        let dir = base.join(rel);
        if !dir.exists() {
            continue;
        }
        freed += dir_size(&dir);
        let _ = std::fs::remove_dir_all(&dir);
    }
    freed
}

/// 当前存储信息：数据目录 + 自定义标记文件位置 + 可清理缓存大小
#[tauri::command]
fn storage_info(app: tauri::AppHandle) -> StorageInfo {
    let default_dir = app
        .path()
        .app_local_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let custom = custom_data_dir(&app);
    let data_dir = custom
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| default_dir.clone());
    let ebwebview = PathBuf::from(&data_dir).join("EBWebView");
    let cache_bytes = CACHE_DIRS
        .iter()
        .map(|rel| dir_size(&ebwebview.join(rel)))
        .sum();
    StorageInfo {
        data_dir,
        is_custom: custom.is_some(),
        marker_path: marker_path(&app),
        cache_bytes,
    }
}

/// 清理 WebView2 缓存（网络缓存、着色器缓存等），返回释放的字节数。
/// 只删缓存目录，Local Storage 等真实数据不动。
#[tauri::command]
fn clean_webview_cache(app: tauri::AppHandle) -> u64 {
    let data_dir = custom_data_dir(&app)
        .unwrap_or_else(|| app.path().app_local_data_dir().unwrap_or_default());
    if data_dir.as_os_str().is_empty() {
        return 0;
    }
    clean_cache_dirs(&data_dir)
}

/// 设置自定义数据目录；传 None 恢复默认。写的是标记文件，重启后才生效。
#[tauri::command]
fn set_data_dir(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let marker = app
        .path()
        .app_config_dir()
        .map(|d| d.join(DATA_DIR_MARKER))
        .map_err(|e| e.to_string())?;
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match path {
        Some(p) if !p.trim().is_empty() => {
            let dir = PathBuf::from(p.trim());
            if !dir.is_dir() {
                return Err("目录不存在".into());
            }
            std::fs::write(&marker, dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        }
        _ => {
            let _ = std::fs::remove_file(&marker);
        }
    }
    Ok(())
}

/// 原生文件夹选择框；取消返回 None。
/// 放在 async 命令里跑，避免阻塞主线程。
#[tauri::command]
async fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择数据存放目录")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

/// 调起系统截图工具的框选模式（等价于 Win+Shift+S）。
/// ms-screenclip: 协议由 Windows 自带截图工具注册（Win10 1809+ / Win11 均可用），
/// 截完的图自动进剪贴板，前端轮询剪贴板拿到图片后即可解码。
#[tauri::command]
fn launch_screen_capture() -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg("ms-screenclip:")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 在资源管理器中打开目录
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 等用户松开物理按下的修饰键（Ctrl/Alt/Win），最多等 1.5 秒。
///
/// 为什么必须等：全局热键在「按下」瞬间就触发，此时用户的手指还压着 Ctrl+Alt。
/// 立刻注入 V 键的话，目标应用收到的是「物理 Alt + 注入 Ctrl + V」= Ctrl+Alt+V，
/// 不是粘贴。这就是为什么瞬时的动作（UUID）粘贴失败、带网络延迟的动作（随机文案）
/// 反而正常——延迟恰好让用户先松了手。
#[cfg(windows)]
fn wait_physical_modifiers_released(timeout: std::time::Duration) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN,
    };
    let start = std::time::Instant::now();
    loop {
        let held = unsafe {
            [VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN]
                .iter()
                .any(|vk| GetAsyncKeyState(*vk as i32) as u16 & 0x8000 != 0)
        };
        if !held || start.elapsed() >= timeout {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

#[cfg(not(windows))]
fn wait_physical_modifiers_released(_timeout: std::time::Duration) {}

/// 向当前聚焦的应用发送 Ctrl+V，配合「复制并粘贴」动作。
/// 执行时机：前端已把结果写入剪贴板之后，此时焦点仍在用户原来的应用上。
///
/// 两个关键点：
/// 1. 先等物理修饰键松开（见 wait_physical_modifiers_released）
/// 2. 用 Key::V 而不是 Key::Unicode('v')：Unicode 走 VK_PACKET 注入，
///    Ctrl+VK_PACKET 在不少应用里不会被视为 Ctrl+V；
///    Key::V 映射成真实虚拟键码 VK_V，行为与真人按键一致。
#[tauri::command]
fn paste_clipboard() -> Result<(), String> {
    wait_physical_modifiers_released(std::time::Duration::from_millis(1500));
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.key(Key::Control, Direction::Press).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(40));
    enigo.key(Key::V, Direction::Click).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(40));
    enigo.key(Key::Control, Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}

/// 同步关闭动作（'tray' | 'exit'）；前端启动时和修改设置时都会调用
#[tauri::command]
fn set_close_action(state: State<'_, CloseAction>, action: String) {
    if action == "tray" || action == "exit" {
        if let Ok(mut guard) = state.0.lock() {
            *guard = action;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(HashMap::<Shortcut, String>::new()))
        .manage(CloseAction(Mutex::new("tray".to_string())))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // 只在按下时触发：不判断的话按一次会收到 Pressed + Released 两次
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let action = app
                        .try_state::<ShortcutRegistry>()
                        .and_then(|state| state.lock().ok().and_then(|map| map.get(shortcut).cloned()));
                    let Some(action) = action else { return };

                    if action == "toggle" {
                        toggle_main(app);
                    } else if let Some(code) = action.strip_prefix("tool:") {
                        show_main(app);
                        let _ = app.emit("shortcut-tool", code.to_string());
                    } else if let Some(code) = action.strip_prefix("copy:") {
                        // 快捷复制：不唤起窗口不抢焦点，派发给前端生成并写剪贴板
                        let _ = app.emit("shortcut-action", QuickAction { kind: "copy", code });
                    } else if let Some(code) = action.strip_prefix("paste:") {
                        // 复制并粘贴：前端复制完成后回调 paste_clipboard，把结果粘进当前应用
                        let _ = app.emit("shortcut-action", QuickAction { kind: "paste", code });
                    } else if action.starts_with("qrcapture:") {
                        // 二维码·截图识别：调起系统截图，识别后回软件展示
                        let _ = app.emit("shortcut-action", QuickAction { kind: "qrcapture", code: "" });
                    } else if action.starts_with("qrread:") {
                        // 二维码·从剪贴板识别：读剪贴板图片识别后回软件展示
                        let _ = app.emit("shortcut-action", QuickAction { kind: "qrread", code: "" });
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_shortcuts,
            set_close_action,
            storage_info,
            set_data_dir,
            pick_folder,
            open_in_explorer,
            clean_webview_cache,
            launch_screen_capture,
            paste_clipboard
        ])
        .setup(|app| {
            // 主窗口从 tauri.conf.json 挪到代码创建：只有这样才能按用户选择
            // 传入 data_directory（WebView2 的 Local Storage 跟着这个目录走）
            let mut builder = WebviewWindowBuilder::new(app.handle(), MAIN_WINDOW, WebviewUrl::default())
                .title("开发百宝箱")
                .inner_size(1200.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .resizable(true)
                .decorations(false);
            if let Some(dir) = custom_data_dir(app.handle()) {
                builder = builder.data_directory(dir);
            }
            builder.build()?;

            // 兜底默认：前端挂载后会下发用户配置，set_shortcuts 会先把这张表清空重建
            if let Ok(shortcut) = "Alt+Space".parse::<Shortcut>() {
                if app.global_shortcut().register(shortcut.clone()).is_ok() {
                    if let Ok(mut map) = app.state::<ShortcutRegistry>().lock() {
                        map.insert(shortcut, "toggle".to_string());
                    }
                }
            }

            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("开发百宝箱")
                .menu(&menu)
                // 左键单击用于唤起窗口，右键才出菜单
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // 点 ✕ 的行为按用户设置走：默认收进托盘；选了「直接退出」则退出应用
            if let WindowEvent::CloseRequested { api, .. } = event {
                let action = window
                    .app_handle()
                    .try_state::<CloseAction>()
                    .and_then(|state| state.0.lock().ok().map(|guard| guard.clone()));
                if action.as_deref() == Some("exit") {
                    window.app_handle().exit(0);
                } else {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
