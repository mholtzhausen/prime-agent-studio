use std::{io::{BufRead, BufReader}, process::{Command, Stdio}, sync::atomic::{AtomicBool, Ordering}};
use tauri::{Manager, WebviewWindow};

#[derive(Default)]
pub struct Components {
    busy: AtomicBool,
}

// Opens the launcher settings window (updates / autostart). Binary paths live in
// Studio Preferences → System, not this window.
#[tauri::command]
pub async fn desktop_components_open(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    super::update_window_only(&window, &app)?;
    super::show_settings(&app)?;
    Ok(())
}

#[tauri::command]
pub async fn desktop_components(
    window: WebviewWindow, app: tauri::AppHandle, action: String, component: Option<String>, path: Option<String>,
) -> Result<serde_json::Value, String> {
    super::native_only(&window)?;
    if !["diagnose", "select", "activate", "discover"].contains(&action.as_str()) {
        return Err("action_invalid".into());
    }
    let state = app.state::<Components>();
    if state.busy.swap(true, Ordering::SeqCst) { return Err("setup_busy".into()); }
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let desktop = worker_app.state::<super::Desktop>();
        let resources = desktop.resources.clone();
        let mut options = serde_json::json!({
            "action": action,
            "dataRoot": desktop.root,
            "resourceDir": resources,
            "port": desktop.port
        });
        options["legacyRoot"] = serde_json::to_value(
            &desktop.prefs.lock().map_err(|_| "preparation_failed")?.legacy_root
        ).map_err(|_| "preparation_failed")?;
        if action == "select" {
            let kind = component.as_deref().unwrap_or("engine");
            if !["engine", "uv", "python"].contains(&kind) { return Err("selection_invalid".into()); }
            let selected = if let Some(value) = path.filter(|p| !p.is_empty()) {
                Some(std::path::PathBuf::from(value))
            } else {
                let picker = rfd::FileDialog::new().set_parent(&window);
                if kind == "engine" { picker.pick_folder() } else { picker.pick_file() }
            };
            let Some(path) = selected else { return Ok(serde_json::json!({"cancelled":true})); };
            options["component"] = kind.into();
            options["path"] = path.to_string_lossy().to_string().into();
        }
        let mut command = Command::new(resources.join("node"));
        command.arg(resources.join("studio/scripts/desktop-components.mjs")).arg(options.to_string())
            .current_dir(&resources).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = command.spawn().map_err(|_| "preparation_failed".to_owned())?;
        let mut result = Err("preparation_failed".to_owned());
        for line in BufReader::new(child.stdout.take().ok_or("preparation_failed")?).lines() {
            let line = line.map_err(|_| "preparation_failed")?;
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
            match value["type"].as_str() {
                Some("result") => { result = Ok(value["result"].clone()); },
                Some("failure") => { result = Ok(serde_json::json!({"failure":value})); },
                _ => {}
            }
        }
        let _ = child.wait();
        result
    }).await.map_err(|_| "preparation_failed".to_owned()).and_then(|r| r);
    state.busy.store(false, Ordering::SeqCst);
    result
}
