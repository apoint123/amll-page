use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use smtc_suite::{
    MediaCommand as SmtcControlCommandInternal, MediaController, MediaUpdate,
    NowPlayingInfo as SmtcNowPlayingInfo, SmtcSessionInfo as SmtcSesssionInfo,
};
use std::sync::mpsc::Receiver;
use std::thread;
use std::{
    sync::{
        Arc, Mutex,
        mpsc::{RecvTimeoutError, Sender},
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListenerCommand {
    RequestUpdate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TextConversionMode {
    Off,
    TraditionalToSimplified,
    SimplifiedToTraditional,
    SimplifiedToTaiwan,
    TaiwanToSimplified,
    SimplifiedToHongKong,
    HongKongToSimplified,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum SmtcEvent {
    TrackMetadata(TrackMetadata),
    CoverData(Option<Vec<u8>>),
    PlaybackStatus(PlaybackStatus),
    SessionsChanged(Vec<SmtcSessionInfo>),
    SelectedSessionVanished(String),
    Error(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_title: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub is_playing: bool,
    pub position_ms: u64,
    pub is_shuffle_active: bool,
    pub repeat_mode: RepeatMode,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct SmtcSessionInfo {
    pub session_id: String,
    pub display_name: String,
}

impl From<SmtcSesssionInfo> for SmtcSessionInfo {
    fn from(info: SmtcSesssionInfo) -> Self {
        Self {
            session_id: info.session_id,
            display_name: info.display_name,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MediaCommand {
    SelectSession { session_id: String },
    SetTextConversion { mode: TextConversionMode },
    SetShuffle { is_active: bool },
    SetRepeatMode { mode: RepeatMode },
    Play,
    Pause,
    SkipNext,
    SkipPrevious,
    SeekTo { time_ms: u64 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    Off,
    One,
    All,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CachedNowPlayingInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_title: Option<String>,
    pub duration_ms: Option<u64>,
    pub is_playing: Option<bool>,
    pub cover_data_hash: Option<u64>,
}

impl From<&SmtcNowPlayingInfo> for CachedNowPlayingInfo {
    fn from(info: &SmtcNowPlayingInfo) -> Self {
        Self {
            title: info.title.clone(),
            artist: info.artist.clone(),
            album_title: info.album_title.clone(),
            duration_ms: info.duration_ms,
            is_playing: info.is_playing,
            cover_data_hash: info.cover_data_hash,
        }
    }
}
pub struct ExternalMediaControllerState {
    pub smtc_command_tx: Arc<Mutex<Sender<SmtcControlCommandInternal>>>,
    pub listener_command_tx: Arc<Mutex<Sender<ListenerCommand>>>,
}

impl ExternalMediaControllerState {
    pub fn send_smtc_command(&self, command: SmtcControlCommandInternal) -> anyhow::Result<()> {
        let guard = self
            .smtc_command_tx
            .lock()
            .map_err(|e| anyhow::anyhow!("SMTC command channel Mutex was poisoned: {}", e))?;
        guard.send(command).context("发送命令到 SMTC 监听线程失败")
    }

    pub fn send_listener_command(&self, command: ListenerCommand) -> anyhow::Result<()> {
        let guard = self
            .listener_command_tx
            .lock()
            .map_err(|e| anyhow::anyhow!("Listener command channel Mutex was poisoned: {}", e))?;
        guard.send(command).context("发送命令到监听线程失败")
    }
}

#[tauri::command]
pub async fn control_external_media(
    payload: MediaCommand,
    state: tauri::State<'_, ExternalMediaControllerState>,
) -> Result<(), String> {
    info!("接收到控制命令: {:?}", payload);

    let command = match payload {
        MediaCommand::SelectSession { session_id } => {
            let target_id = if session_id == "null" {
                "".to_string()
            } else {
                session_id
            };
            smtc_suite::MediaCommand::SelectSession(target_id)
        }
        MediaCommand::SetTextConversion { mode } => {
            let suite_mode = match mode {
                TextConversionMode::Off => smtc_suite::TextConversionMode::Off,
                TextConversionMode::TraditionalToSimplified => {
                    smtc_suite::TextConversionMode::TraditionalToSimplified
                }
                TextConversionMode::SimplifiedToTraditional => {
                    smtc_suite::TextConversionMode::SimplifiedToTraditional
                }
                TextConversionMode::SimplifiedToTaiwan => {
                    smtc_suite::TextConversionMode::SimplifiedToTaiwan
                }
                TextConversionMode::TaiwanToSimplified => {
                    smtc_suite::TextConversionMode::TaiwanToSimplified
                }
                TextConversionMode::SimplifiedToHongKong => {
                    smtc_suite::TextConversionMode::SimplifiedToHongKong
                }
                TextConversionMode::HongKongToSimplified => {
                    smtc_suite::TextConversionMode::HongKongToSimplified
                }
            };
            smtc_suite::MediaCommand::SetTextConversion(suite_mode)
        }
        MediaCommand::SetShuffle { is_active } => {
            smtc_suite::MediaCommand::Control(smtc_suite::SmtcControlCommand::SetShuffle(is_active))
        }
        MediaCommand::SetRepeatMode { mode } => {
            let suite_mode = match mode {
                RepeatMode::Off => smtc_suite::RepeatMode::Off,
                RepeatMode::One => smtc_suite::RepeatMode::One,
                RepeatMode::All => smtc_suite::RepeatMode::All,
            };
            smtc_suite::MediaCommand::Control(smtc_suite::SmtcControlCommand::SetRepeatMode(
                suite_mode,
            ))
        }
        MediaCommand::Play => {
            smtc_suite::MediaCommand::Control(smtc_suite::SmtcControlCommand::Play)
        }
        MediaCommand::Pause => {
            smtc_suite::MediaCommand::Control(smtc_suite::SmtcControlCommand::Pause)
        }
        MediaCommand::SkipNext => {
            smtc_suite::MediaCommand::Control(smtc_suite::SmtcControlCommand::SkipNext)
        }
        MediaCommand::SkipPrevious => {
            smtc_suite::MediaCommand::Control(smtc_suite::SmtcControlCommand::SkipPrevious)
        }
        MediaCommand::SeekTo { time_ms } => {
            smtc_suite::MediaCommand::Control(smtc_suite::SmtcControlCommand::SeekTo(time_ms))
        }
    };

    state.send_smtc_command(command).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn request_smtc_update(
    state: tauri::State<'_, ExternalMediaControllerState>,
) -> Result<(), String> {
    info!("正在请求 SMTC 更新...");
    state
        .send_listener_command(ListenerCommand::RequestUpdate)
        .map_err(|e| e.to_string())
}

pub fn start_listener<R: Runtime>(app_handle: AppHandle<R>) -> ExternalMediaControllerState {
    info!("正在启动 SMTC 监听器...");
    let controller = match smtc_suite::MediaManager::start() {
        Ok(c) => c,
        Err(e) => {
            error!("启动 smtc-suite MediaManager 失败: {}", e);
            let (smtc_tx, _) = std::sync::mpsc::channel();
            let (listener_tx, _) = std::sync::mpsc::channel();
            return ExternalMediaControllerState {
                smtc_command_tx: Arc::new(Mutex::new(smtc_tx)),
                listener_command_tx: Arc::new(Mutex::new(listener_tx)),
            };
        }
    };

    let smtc_command_tx_clone = controller.command_tx.clone();

    let (listener_command_tx, listener_command_rx) = std::sync::mpsc::channel::<ListenerCommand>();

    thread::Builder::new()
        .name("smtc-event-bridge".into())
        .spawn(move || {
            event_bridge_main_loop(app_handle, controller, listener_command_rx);
        })
        .expect("创建 smtc-event-bridge 线程失败");

    ExternalMediaControllerState {
        smtc_command_tx: Arc::new(Mutex::new(smtc_command_tx_clone)),
        listener_command_tx: Arc::new(Mutex::new(listener_command_tx)),
    }
}

fn parse_apple_music_field(mut info: SmtcNowPlayingInfo) -> SmtcNowPlayingInfo {
    if let Some(original_artist_field) = info.artist.take() {
        if let Some((artist, album)) = original_artist_field.split_once(" — ") {
            info.artist = Some(artist.trim().to_string());
            if info.album_title.as_deref().unwrap_or("").is_empty() {
                info.album_title = Some(album.trim().to_string());
            }
        } else {
            info.artist = Some(original_artist_field);
        }
    }
    info
}

fn get_estimated_pos(info: &SmtcNowPlayingInfo) -> Option<u64> {
    if info.is_playing.unwrap_or(false)
        && let (Some(last_pos_ms), Some(report_time)) =
            (info.position_ms, info.position_report_time)
    {
        let elapsed_ms = report_time.elapsed().as_millis() as u64;
        let estimated_pos = last_pos_ms + elapsed_ms;
        if let Some(duration_ms) = info.duration_ms
            && duration_ms > 0
        {
            return Some(estimated_pos.min(duration_ms));
        }
        return Some(estimated_pos);
    }
    info.position_ms
}

fn event_bridge_main_loop<R: Runtime>(
    app_handle: AppHandle<R>,
    controller: MediaController,
    command_rx: Receiver<ListenerCommand>,
) {
    let mut last_known_info: Option<SmtcNowPlayingInfo> = None;
    let mut last_sent_cover_hash: u64 = 0;

    loop {
        if let Ok(command) = command_rx.try_recv() {
            match command {
                ListenerCommand::RequestUpdate => {
                    info!("收到更新请求，正在重新发送当前状态...");
                    if let Some(info) = &last_known_info {
                        let track_payload = SmtcEvent::TrackMetadata(TrackMetadata {
                            title: info.title.clone(),
                            artist: info.artist.clone(),
                            album_title: info.album_title.clone(),
                            duration_ms: info.duration_ms,
                        });
                        let _ = app_handle.emit("smtc_update", track_payload);

                        let cover_payload = SmtcEvent::CoverData(info.cover_data.clone());
                        let _ = app_handle.emit("smtc_update", cover_payload);

                        let estimated_pos = get_estimated_pos(info).unwrap_or(0);
                        let playback_payload = SmtcEvent::PlaybackStatus(PlaybackStatus {
                            is_playing: info.is_playing.unwrap_or(false),
                            position_ms: estimated_pos,
                            is_shuffle_active: info.is_shuffle_active.unwrap_or(false),
                            repeat_mode: info
                                .repeat_mode
                                .map(|m| match m {
                                    smtc_suite::RepeatMode::Off => RepeatMode::Off,
                                    smtc_suite::RepeatMode::One => RepeatMode::One,
                                    smtc_suite::RepeatMode::All => RepeatMode::All,
                                })
                                .unwrap_or(RepeatMode::Off),
                        });
                        let _ = app_handle.emit("smtc_update", playback_payload);

                        if let Err(e) = controller
                            .command_tx
                            .send(smtc_suite::MediaCommand::RequestUpdate)
                        {
                            error!("向 smtc-suite 发送 RequestUpdate 命令失败: {}", e);
                        }
                    }
                }
            }
        }

        match controller
            .update_rx
            .recv_timeout(Duration::from_millis(100))
        {
            Ok(update) => match update {
                MediaUpdate::TrackChanged(info) => {
                    let info = parse_apple_music_field(info);

                    // 发送元数据
                    let _ = app_handle.emit(
                        "smtc_update",
                        SmtcEvent::TrackMetadata(TrackMetadata {
                            title: info.title.clone(),
                            artist: info.artist.clone(),
                            album_title: info.album_title.clone(),
                            duration_ms: info.duration_ms,
                        }),
                    );

                    // 检查并发送封面
                    let cover_hash = info.cover_data_hash.unwrap_or(0);
                    if cover_hash != last_sent_cover_hash {
                        let _ = app_handle
                            .emit("smtc_update", SmtcEvent::CoverData(info.cover_data.clone()));
                        last_sent_cover_hash = cover_hash;
                    }

                    // 在曲目变更后，立即发送一次完整的播放状态
                    let _ = app_handle.emit(
                        "smtc_update",
                        SmtcEvent::PlaybackStatus(PlaybackStatus {
                            is_playing: info.is_playing.unwrap_or(false),
                            position_ms: get_estimated_pos(&info).unwrap_or(0),
                            is_shuffle_active: info.is_shuffle_active.unwrap_or(false),
                            repeat_mode: info
                                .repeat_mode
                                .map(|m| match m {
                                    smtc_suite::RepeatMode::Off => RepeatMode::Off,
                                    smtc_suite::RepeatMode::One => RepeatMode::One,
                                    smtc_suite::RepeatMode::All => RepeatMode::All,
                                })
                                .unwrap_or(RepeatMode::Off),
                        }),
                    );

                    last_known_info = Some(info);
                }

                MediaUpdate::SessionsChanged(sessions) => {
                    debug!("SMTC SessionsChanged: {} 个会话", sessions.len());
                    let payload = SmtcEvent::SessionsChanged(
                        sessions.into_iter().map(SmtcSessionInfo::from).collect(),
                    );
                    let _ = app_handle.emit("smtc_update", payload);
                }
                MediaUpdate::SelectedSessionVanished(id) => {
                    warn!("SMTC 选择的会话已消失: {}", id);
                    let payload = SmtcEvent::SelectedSessionVanished(id);
                    let _ = app_handle.emit("smtc_update", payload);
                    last_known_info = None;
                }
                MediaUpdate::Error(e) => {
                    error!("SMTC 运行时错误: {}", e);
                    let payload = SmtcEvent::Error(e.to_string());
                    let _ = app_handle.emit("smtc_update", payload);
                }
                _ => {}
            },
            Err(RecvTimeoutError::Timeout) => {
                // 在轮询时，也发送完整的播放状态
                if let Some(info) = &last_known_info {
                    let _ = app_handle.emit(
                        "smtc_update",
                        SmtcEvent::PlaybackStatus(PlaybackStatus {
                            is_playing: info.is_playing.unwrap_or(false),
                            position_ms: get_estimated_pos(info).unwrap_or(0),
                            is_shuffle_active: info.is_shuffle_active.unwrap_or(false),
                            repeat_mode: info
                                .repeat_mode
                                .map(|m| match m {
                                    smtc_suite::RepeatMode::Off => RepeatMode::Off,
                                    smtc_suite::RepeatMode::One => RepeatMode::One,
                                    smtc_suite::RepeatMode::All => RepeatMode::All,
                                })
                                .unwrap_or(RepeatMode::Off),
                        }),
                    );
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                info!("媒体事件通道已关闭，程序退出。");
                break;
            }
        }
    }
}
