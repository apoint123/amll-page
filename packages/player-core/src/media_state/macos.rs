use std::{
    ptr::NonNull,
    sync::{
        RwLock,
        atomic::{AtomicBool, Ordering},
    },
};

use super::*;
use anyhow::Context;
use objc2::{
    rc::*,
    runtime::{AnyObject, NSObject},
};
use objc2_app_kit::*;
use objc2_foundation::*;
use objc2_media_player::*;
use tokio::sync::mpsc::UnboundedSender;
use tracing::warn;

// static NP_INFO_CTR_LOCK: Mutex<()> = Mutex::new(());

type CommandHandler =
    block2::RcBlock<dyn Fn(NonNull<MPRemoteCommandEvent>) -> MPRemoteCommandHandlerStatus>;

pub struct MediaStateManagerMacOSBackend {
    np_info_ctr: Retained<MPNowPlayingInfoCenter>,
    cmd_ctr: Retained<MPRemoteCommandCenter>,
    info: RwLock<Retained<NSMutableDictionary<NSString, AnyObject>>>,
    playing: AtomicBool,
    _sender: UnboundedSender<MediaStateMessage>,

    play_handler: Retained<CommandHandler>,
    pause_handler: Retained<CommandHandler>,
    toggle_play_pause_handler: Retained<CommandHandler>,
    previous_track_handler: Retained<CommandHandler>,
    next_track_handler: Retained<CommandHandler>,
    change_playback_position_handler: Retained<CommandHandler>,
}

impl std::fmt::Debug for MediaStateManagerMacOSBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MediaStateManagerMacOSBackend")
            .field("np_info_ctr", &self.np_info_ctr)
            .field("info", &self.info)
            .field("playing", &self.playing.load(Ordering::Relaxed))
            .finish()
    }
}

impl MediaStateManagerBackend for MediaStateManagerMacOSBackend {
    fn new() -> anyhow::Result<(Self, UnboundedReceiver<MediaStateMessage>)> {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        let np_info_ctr = unsafe { MPNowPlayingInfoCenter::defaultCenter() };
        let cmd_ctr = unsafe { MPRemoteCommandCenter::sharedCommandCenter() };
        let dict: Retained<NSMutableDictionary<NSString, AnyObject>> = NSMutableDictionary::new();
        unsafe {
            dict.setValue_forKey(
                Some(&NSNumber::new_usize(MPMediaType::Music.0)),
                MPMediaItemPropertyMediaType,
            );
        }

        let play_command = unsafe { cmd_ctr.playCommand() };
        let sender_clone = sender.clone();
        let play_handler = block2::RcBlock::new(
            move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                let _ = sender_clone.send(MediaStateMessage::Play);
                MPRemoteCommandHandlerStatus::Success
            },
        );
        unsafe { play_command.addTargetWithHandler(&play_handler) };

        let pause_command = unsafe { cmd_ctr.pauseCommand() };
        let sender_clone = sender.clone();
        let pause_handler = block2::RcBlock::new(
            move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                let _ = sender_clone.send(MediaStateMessage::Pause);
                MPRemoteCommandHandlerStatus::Success
            },
        );
        unsafe { pause_command.addTargetWithHandler(&pause_handler) };

        let change_playback_position_command = unsafe { cmd_ctr.changePlaybackPositionCommand() };
        let sender_clone = sender.clone();
        let change_playback_position_handler = block2::RcBlock::new(
            move |mut evt: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                if let Some(evt) = unsafe { Retained::retain(evt.as_mut()) } {
                    if let Ok(evt) = evt.downcast::<MPChangePlaybackPositionCommandEvent>() {
                        let pos = unsafe { evt.positionTime() };
                        let _ = sender_clone.send(MediaStateMessage::Seek(pos));
                    }
                }
                MPRemoteCommandHandlerStatus::Success
            },
        );
        unsafe {
            change_playback_position_command.addTargetWithHandler(&change_playback_position_handler)
        };

        let toggle_play_pause_command = unsafe { cmd_ctr.togglePlayPauseCommand() };
        let sender_clone = sender.clone();
        let toggle_play_pause_handler = block2::RcBlock::new(
            move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                let _ = sender_clone.send(MediaStateMessage::PlayOrPause);
                MPRemoteCommandHandlerStatus::Success
            },
        );
        unsafe { toggle_play_pause_command.addTargetWithHandler(&toggle_play_pause_handler) };

        let previous_track_command = unsafe { cmd_ctr.previousTrackCommand() };
        let sender_clone = sender.clone();
        let previous_track_handler = block2::RcBlock::new(
            move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                let _ = sender_clone.send(MediaStateMessage::Previous);
                MPRemoteCommandHandlerStatus::Success
            },
        );
        unsafe { previous_track_command.addTargetWithHandler(&previous_track_handler) };

        let next_track_command = unsafe { cmd_ctr.nextTrackCommand() };
        let sender_clone = sender.clone();
        let next_track_handler = block2::RcBlock::new(
            move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                let _ = sender_clone.send(MediaStateMessage::Next);
                MPRemoteCommandHandlerStatus::Success
            },
        );
        unsafe { next_track_command.addTargetWithHandler(&next_track_handler) };

        Ok((
            Self {
                np_info_ctr,
                cmd_ctr,
                info: RwLock::new(dict),
                playing: AtomicBool::new(false),
                _sender: sender,
                play_handler,
                pause_handler,
                toggle_play_pause_handler,
                previous_track_handler,
                next_track_handler,
                change_playback_position_handler,
            },
            receiver,
        ))
    }

    fn set_playing(&self, playing: bool) -> anyhow::Result<()> {
        self.playing.store(playing, Ordering::Relaxed);
        let playback_state = if playing {
            MPNowPlayingPlaybackState::Playing
        } else {
            MPNowPlayingPlaybackState::Paused
        };
        unsafe {
            self.np_info_ctr.setPlaybackState(playback_state);
        }
        Ok(())
    }

    fn set_title(&self, title: &str) -> anyhow::Result<()> {
        let title_ns = NSString::from_str(title);
        unsafe {
            self.info
                .write()
                .expect("Media info 锁已毒化")
                .setValue_forKey(Some(&title_ns), MPMediaItemPropertyTitle);
        }
        Ok(())
    }

    fn set_artist(&self, artist: &str) -> anyhow::Result<()> {
        let artist_ns = NSString::from_str(artist);
        unsafe {
            self.info
                .write()
                .expect("Media info 锁已毒化")
                .setValue_forKey(Some(&artist_ns), MPMediaItemPropertyArtist);
        }
        Ok(())
    }

    fn set_duration(&self, duration: f64) -> anyhow::Result<()> {
        let duration_ns = NSNumber::new_f64(duration);
        unsafe {
            self.info
                .write()
                .expect("Media info 锁已毒化")
                .setValue_forKey(Some(&duration_ns), MPMediaItemPropertyPlaybackDuration);
        }
        Ok(())
    }

    fn set_position(&self, position: f64) -> anyhow::Result<()> {
        let position_ns = NSNumber::new_f64(position);
        unsafe {
            self.info
                .write()
                .expect("Media info 锁已毒化")
                .setValue_forKey(
                    Some(&position_ns),
                    MPNowPlayingInfoPropertyElapsedPlaybackTime,
                );
        }
        Ok(())
    }

    fn set_cover_image(&self, cover_data: impl AsRef<[u8]>) -> anyhow::Result<()> {
        let cover_data = cover_data.as_ref();
        if cover_data.is_empty() {
            unsafe {
                self.info
                    .write()
                    .expect("Media info 锁已毒化")
                    .setValue_forKey(None, MPMediaItemPropertyArtwork);
            }
            return Ok(());
        }

        let data = NSData::from_vec(cover_data.to_vec());
        let img: Retained<NSImage> = NSImage::initWithData(NSImage::alloc(), &data)
            .context("尝试从给定的数据初始化 NSImage 对象时失败")?;
        let img_size = unsafe { img.size() };

        let artwork = MPMediaItemArtwork::alloc();
        let req_handler =
            block2::RcBlock::new(move |_: NSSize| -> *const NSImage { Retained::as_raw(&img) });

        let artwork = unsafe {
            MPMediaItemArtwork::initWithBoundsSize_requestHandler(artwork, img_size, &req_handler)
        };

        unsafe {
            self.info
                .write()
                .expect("Media info 锁已毒化")
                .setValue_forKey(Some(&artwork), MPMediaItemPropertyArtwork);
        }
        Ok(())
    }

    fn update(&self) -> anyhow::Result<()> {
        let np_info_copy = {
            let np_info = self.info.read().expect("Media info 锁已毒化");
            np_info.copy()
        };

        unsafe {
            self.np_info_ctr.setNowPlayingInfo(Some(&np_info_copy));
        }
        Ok(())
    }
}

impl Drop for MediaStateManagerMacOSBackend {
    fn drop(&mut self) {
        unsafe {
            self.cmd_ctr.playCommand().removeTarget(&self.play_handler);
            self.cmd_ctr
                .pauseCommand()
                .removeTarget(&self.pause_handler);
            self.cmd_ctr
                .togglePlayPauseCommand()
                .removeTarget(&self.toggle_play_pause_handler);
            self.cmd_ctr
                .previousTrackCommand()
                .removeTarget(&self.previous_track_handler);
            self.cmd_ctr
                .nextTrackCommand()
                .removeTarget(&self.next_track_handler);
            self.cmd_ctr
                .changePlaybackPositionCommand()
                .removeTarget(&self.change_playback_position_handler);
        }
    }
}
