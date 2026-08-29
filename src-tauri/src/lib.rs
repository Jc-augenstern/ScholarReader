mod ai;
mod commands;
mod database;
mod diagnostics;
mod error;
mod models;

use database::AppState;
use std::{collections::HashMap, sync::Arc};
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            let log_dir = app.path().app_log_dir()?;
            diagnostics::initialize(log_dir, &app.package_info().version.to_string())?;
            let pool = tauri::async_runtime::block_on(database::connect(&data_dir))
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let managed_ai = ai::AIServiceManager::new(data_dir.join("managed-ai"))
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            tauri::async_runtime::block_on(async {
                let settings = ai::config::load_settings(&pool).await?;
                managed_ai.provider_state(&settings, false).await;
                Ok::<(), error::AppError>(())
            })
            .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            managed_ai.start_idle_monitor();
            app.manage(AppState {
                pool,
                ai_requests: Arc::new(Mutex::new(HashMap::new())),
                managed_ai,
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<AppState>().managed_ai.shutdown_blocking();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::get_ai_settings,
            commands::ai::get_ai_provider_state,
            commands::ai::save_ai_settings,
            commands::ai::test_ai_connection,
            commands::ai::run_ai_action,
            commands::ai::cancel_ai_request,
            commands::managed_ai::assess_managed_ai,
            commands::managed_ai::get_managed_ai_status,
            commands::managed_ai::prepare_managed_ai,
            commands::managed_ai::pause_managed_ai_setup,
            commands::managed_ai::cancel_managed_ai_setup,
            commands::managed_ai::delete_managed_ai_models,
            commands::managed_ai::restart_managed_ai,
            commands::managed_ai::test_managed_ai,
            commands::settings::get_app_settings,
            commands::settings::save_app_settings,
            commands::documents::list_documents,
            commands::documents::get_document,
            commands::documents::import_documents,
            commands::documents::import_pdf_folder,
            commands::documents::remove_document,
            commands::documents::rename_document,
            commands::documents::set_document_starred,
            commands::documents::read_document_bytes,
            commands::documents::set_document_page_count,
            commands::documents::check_rebind_candidate,
            commands::documents::rebind_document,
            commands::diagnostics::record_frontend_error,
            commands::diagnostics::record_frontend_event,
            commands::diagnostics::get_diagnostics,
            commands::diagnostics::open_diagnostics_logs,
            commands::diagnostics::export_diagnostics_report,
            commands::progress::get_reading_progress,
            commands::progress::save_reading_progress,
            commands::favorites::list_favorites,
            commands::favorites::get_favorite,
            commands::favorites::create_favorite,
            commands::favorites::update_favorite,
            commands::favorites::delete_favorite,
            commands::favorites::list_tags,
            commands::favorites::rename_tag,
            commands::favorites::delete_tag,
            commands::favorites::merge_tags,
            commands::platform::open_document_external,
            commands::platform::reveal_document_in_manager,
            commands::health::database_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
