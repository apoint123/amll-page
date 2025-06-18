use amll_player_core::*;
use tauri::{Emitter, Manager, Runtime};
use tokio::sync::RwLock;
use tracing::warn;

static PLAYER_HANDLER: RwLock<Option<AudioPlayerHandle>> = RwLock::const_new(None);

#[tauri::command]
pub async fn local_player_send_msg(msg: AudioThreadEventMessage<AudioThreadMessage>) {
    if let Some(handler) = &*PLAYER_HANDLER.read().await {
        if let Err(err) = handler.send(msg).await {
            warn!("failed to send msg to local player: {:?}", err);
        }
    }
}

async fn local_player_main<R: Runtime>(manager: impl Manager<R> + Clone + Send + Sync + 'static) {
    #[cfg(mobile)]
    let mut player = AudioPlayer::new(AudioPlayerConfig {});
    #[cfg(not(mobile))]
    let player = AudioPlayer::new(AudioPlayerConfig {});
    let handler = player.handler();
    PLAYER_HANDLER.write().await.replace(handler);

    let manager_clone = manager.clone();
    #[cfg(mobile)]
    player.set_custom_local_song_loader(Box::new(move |path| {
        use std::str::FromStr;
        use tauri_plugin_fs::FsExt;
        use tauri_plugin_fs::OpenOptions;
        let manager_clone = manager_clone.clone();
        Box::new(async move {
            let fs = manager_clone.fs();
            let mut opt = OpenOptions::new();
            opt.read(true);
            let file_path = tauri_plugin_fs::FilePath::from_str(&path)?;
            let file = fs.open(file_path, opt)?;
            Ok(file)
        })
    }));

    // async_std::net::TcpStream::connect(addrs)

    // async_tungstenite::client_async(request, stream)

    player
        .run(move |evt| {
            let app = manager.app_handle();
            if let Err(err) = app.emit("audio_player_msg", evt) {
                warn!("failed to emit audio_player_msg: {:?}", err);
            }
        })
        .await;
}

pub fn init_local_player<R: Runtime>(emitter: impl Manager<R> + Clone + Send + Sync + 'static) {
    tauri::async_runtime::spawn(async move {
        local_player_main(emitter).await;
    });
}