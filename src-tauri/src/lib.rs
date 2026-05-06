mod agent_trace;
mod claude;
mod filestore;
mod fs_tree;
mod intake;
mod kb;
mod mcp;
mod keychain;
mod openit_config;
mod project;
mod pty;
mod reports;
mod scripts;
mod skill_canvas;
mod skills;
mod slack;
mod state;
mod tools;
mod tunnel;
mod user_identity;
mod watcher;
mod workspaces;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            let _ = app;
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(watcher::WatcherState::default())
        .manage(intake::IntakeState::default())
        .manage(tunnel::TunnelState::default())
        .manage(slack::SlackSupervisorState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::claude_detect,
            pty::claude_install,
            fs_tree::fs_list,
            fs_tree::fs_read,
            fs_tree::fs_read_bytes,
            fs_tree::fs_reveal,
            fs_tree::fs_open,
            fs_tree::fs_delete,
            user_identity::global_user_email,
            claude::claude_generate_commit_message,
            tools::tools_is_installed,
            tools::tools_target_os,
            tools::tools_install,
            tools::tools_uninstall,
            tools::tools_remove_hint_only,
            state::state_load,
            state::state_save,
            keychain::keychain_set,
            keychain::keychain_get,
            keychain::keychain_delete,
            keychain::keychain_probe,
            mcp::list_installed_mcps,
            project::project_bootstrap,
            workspaces::list_workspaces,
            workspaces::create_workspace,
            workspaces::set_active_workspace,
            workspaces::remove_workspace,
            reports::report_overview_run,
            scripts::script_run,
            kb::kb_init,
            kb::kb_delete_file,
            kb::kb_read_file,
            kb::kb_write_file,
            kb::kb_write_file_bytes,
            kb::kb_download_to_local,
            kb::kb_upload_file,
            kb::kb_list_remote,
            kb::kb_supported_extensions,
            kb::fs_store_init,
            kb::fs_store_read_file,
            kb::fs_store_write_file,
            kb::fs_store_write_file_bytes,
            kb::fs_store_download_to_local,
            kb::fs_store_upload_file,
            kb::fs_store_upload_via_signed_url,
            kb::entity_state_load,
            kb::entity_state_save,
            kb::entity_list_local,
            kb::entity_write_file,
            kb::entity_write_file_bytes,
            kb::entity_delete_file,
            kb::entity_rename_file,
            kb::entity_clear_dir,
            skills::skills_fetch_manifest,
            skills::skills_fetch_file,
            skills::skills_fetch_bundled_manifest,
            skills::skills_fetch_bundled_file,
            filestore::filestore_list_collections,
            filestore::datastore_list_collections,
            watcher::fs_watch_start,
            watcher::fs_watch_stop,
            intake::intake_start,
            intake::intake_stop,
            intake::intake_url,
            tunnel::tunnel_start,
            tunnel::tunnel_stop,
            tunnel::tunnel_url,
            agent_trace::agent_trace_latest,
            skill_canvas::skill_state_read,
            skill_canvas::skill_state_write,
            skill_canvas::skill_state_clear,
            slack::slack_connect,
            slack::slack_validate_bot_token,
            slack::slack_disconnect,
            slack::slack_config_read,
            slack::slack_listener_start,
            slack::slack_listener_stop,
            slack::slack_listener_status,
            slack::slack_listener_send_intro,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
