// 发布版不显示控制台窗口；debug 版保留，方便看 Rust 侧日志
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    devbox_app_lib::run()
}
