use std::ptr::NonNull;

use super::*;
use dispatch::Queue;
use objc2::AnyThread;
use objc2::{rc::*, runtime::AnyObject};
use objc2_app_kit::*;
use objc2_foundation::*;
use objc2_media_player::*;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

/// 适用于 macOS 平台的媒体状态管理器后端实现。
///
/// 这个结构体通过与 `MediaPlayer` 和 `AppKit` 框架交互，实现了在 macOS 系统上
/// 注册媒体控制（如播放、暂停、下一首等）以及更新“正在播放”信息（如歌曲标题、艺术家、封面图）的功能。
///
/// 它在内部使用一个 `tokio` MPSC channel 将来自系统主线程的媒体控制事件发送到 Rust 的异步世界中。
#[derive(Debug)]
pub struct MediaStateManagerMacOSBackend {
    // 这个 sender 用于在 `new` 函数中设置的回调闭包里，将媒体控制事件发送出去。
    // 尽管结构体本身的方法没有直接使用它，但必须持有它以保持 channel 的发送端存活。
    _sender: UnboundedSender<MediaStateMessage>,
}

// ## 安全性 (Safety)
//
// `MediaStateManagerMacOSBackend` 结构体本身只包含一个 `UnboundedSender`，
// 它是线程安全的 (`Send + Sync`)。然而，此结构体的功能依赖于在 `new` 方法中创建的、
// 与 macOS 主线程绑定的 Objective-C 对象和回调。
//
// 我们将此结构体标记为 `Send` 和 `Sync` 是基于以下保证：
// 1.  所有与 AppKit/MediaPlayer UI 相关的操作都通过 `Queue::main().exec_async`
//     被异步地调度到主线程执行。
// 2.  这意味着即使从其他线程调用 `set_title`, `set_playing` 等方法，实际的 UI 更新
//     也总是在正确的线程（主线程）上安全地发生。
// 3.  因此，从任何线程持有或发送 `MediaStateManagerMacOSBackend` 的实例都是安全的。
unsafe impl Send for MediaStateManagerMacOSBackend {}
unsafe impl Sync for MediaStateManagerMacOSBackend {}

impl MediaStateManagerBackend for MediaStateManagerMacOSBackend {
    /// 创建一个新的 `MediaStateManagerMacOSBackend` 实例。
    ///
    /// 此函数会执行以下操作：
    /// 1. 创建一个 MPSC channel，用于从原生回调向 Rust 异步代码发送消息。
    /// 2. 在 macOS 的主线程上，获取 `MPRemoteCommandCenter` 的单例实例。
    /// 3. 为各种媒体控制命令（播放、暂停、下一首、上一首、跳转等）注册处理器（handler）。
    ///    这些处理器会将对应的 `MediaStateMessage` 通过 channel 发送出去。
    ///
    // * ## 返回值
    // *
    // * `Ok((Self, UnboundedReceiver<MediaStateMessage>))`：
    // *   - `Self`：后端实例，可用于更新“正在播放”信息。
    // *   - `UnboundedReceiver`：接收器，用于在应用程序的主逻辑中接收媒体控制事件。
    fn new() -> anyhow::Result<(Self, UnboundedReceiver<MediaStateMessage>)> {
        // 创建一个无界 MPSC channel，用于跨线程通信。
        // sender 用于从主线程的 Objective-C 回调中发送事件。
        // receiver 由调用者持有，用于在异步任务中接收事件。
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        let sender_for_closure = sender.clone();

        // 所有与 `MPRemoteCommandCenter` 的交互都必须在主线程上进行。
        // `Queue::main().exec_sync` 会阻塞当前线程，直到主线程上的闭包执行完毕。
        Queue::main().exec_sync(move || {
            // ## 安全性 (Safety)
            //
            // `MPRemoteCommandCenter::sharedCommandCenter()` 是一个 FFI (外部函数接口) 调用。
            // Rust 编译器无法验证其安全性。
            // 我们能确保其安全，因为：
            // 1. 官方文档指明 `sharedCommandCenter` 返回一个有效的单例对象。
            // 2. 我们正在主线程上调用它，这符合 `MediaPlayer` 框架的线程要求。
            let cmd_ctr = unsafe { MPRemoteCommandCenter::sharedCommandCenter() };

            // --- 注册播放命令处理器 ---
            let play_command = unsafe { cmd_ctr.playCommand() };
            let sender_clone = sender_for_closure.clone();
            let play_handler = block2::RcBlock::new(
                move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                    // 忽略发送结果，因为如果接收端已关闭，我们无能为力。
                    let _ = sender_clone.send(MediaStateMessage::Play);
                    MPRemoteCommandHandlerStatus::Success
                },
            );
            // ## 安全性 (Safety)
            // `addTargetWithHandler` 是一个 FFI 调用。
            // 我们能确保其安全，因为：
            // 1. `play_command` 是一个有效的 `MPRemoteCommand` 对象。
            // 2. `play_handler` 是一个符合 API 要求的有效 Objective-C block。
            // 3. `RcBlock` 保证了 block 的生命周期，直到它被 Objective-C 运行时释放。
            unsafe { play_command.addTargetWithHandler(&play_handler) };

            // --- 注册暂停命令处理器 ---
            let pause_command = unsafe { cmd_ctr.pauseCommand() };
            let sender_clone = sender_for_closure.clone();
            let pause_handler = block2::RcBlock::new(
                move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                    let _ = sender_clone.send(MediaStateMessage::Pause);
                    MPRemoteCommandHandlerStatus::Success
                },
            );
            unsafe { pause_command.addTargetWithHandler(&pause_handler) };

            // --- 注册播放/暂停切换命令处理器 ---
            let toggle_play_pause_command = unsafe { cmd_ctr.togglePlayPauseCommand() };
            let sender_clone = sender_for_closure.clone();
            let toggle_play_pause_handler = block2::RcBlock::new(
                move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                    let _ = sender_clone.send(MediaStateMessage::PlayOrPause);
                    MPRemoteCommandHandlerStatus::Success
                },
            );
            unsafe { toggle_play_pause_command.addTargetWithHandler(&toggle_play_pause_handler) };

            // --- 注册上一首命令处理器 ---
            let previous_track_command = unsafe { cmd_ctr.previousTrackCommand() };
            let sender_clone = sender_for_closure.clone();
            let previous_track_handler = block2::RcBlock::new(
                move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                    let _ = sender_clone.send(MediaStateMessage::Previous);
                    MPRemoteCommandHandlerStatus::Success
                },
            );
            unsafe { previous_track_command.addTargetWithHandler(&previous_track_handler) };

            // --- 注册下一首命令处理器 ---
            let next_track_command = unsafe { cmd_ctr.nextTrackCommand() };
            let sender_clone = sender_for_closure.clone();
            let next_track_handler = block2::RcBlock::new(
                move |_: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                    let _ = sender_clone.send(MediaStateMessage::Next);
                    MPRemoteCommandHandlerStatus::Success
                },
            );
            unsafe { next_track_command.addTargetWithHandler(&next_track_handler) };

            // --- 注册更改播放位置命令处理器 ---
            let change_playback_position_command =
                unsafe { cmd_ctr.changePlaybackPositionCommand() };
            let sender_clone = sender_for_closure.clone();
            let change_playback_position_handler = block2::RcBlock::new(
                move |mut evt: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
                    // ## 安全性 (Safety)
                    // `Retained::retain` 从一个裸指针创建一个受管的 `Retained` 指针。
                    // 这是不安全的，因为裸指针 `evt` 可能无效。
                    // 我们能确保其安全，因为：
                    // 1. 这个闭包由系统调用，传入的 `evt` 指针是有效的。
                    // 2. `retain` 操作正确地增加了 Objective-C 对象的引用计数，防止其在闭包执行期间被释放。
                    if let Some(evt) = unsafe { Retained::retain(evt.as_mut()) } {
                        // 尝试将通用事件对象向下转型为特定类型 `MPChangePlaybackPositionCommandEvent`。
                        if let Ok(evt) = evt.downcast::<MPChangePlaybackPositionCommandEvent>() {
                            // ## 安全性 (Safety)
                            // `evt.positionTime()` 是一个 FFI 调用。
                            // 我们能确保其安全，因为我们已经成功地将 `evt` 向下转型，
                            // 确认了它就是 `MPChangePlaybackPositionCommandEvent` 类型，并且拥有 `positionTime` 方法。
                            let pos = unsafe { evt.positionTime() };
                            let _ = sender_clone.send(MediaStateMessage::Seek(pos));
                        }
                    }
                    MPRemoteCommandHandlerStatus::Success
                },
            );
            unsafe {
                change_playback_position_command
                    .addTargetWithHandler(&change_playback_position_handler)
            };
        });

        Ok((Self { _sender: sender }, receiver))
    }

    /// 设置系统的“正在播放”状态为播放或暂停。
    ///
    /// 此操作是异步的，会调度到主线程执行。
    fn set_playing(&self, playing: bool) -> anyhow::Result<()> {
        Queue::main().exec_async(move || {
            // ## 安全性 (Safety)
            // 与 `MPNowPlayingInfoCenter` 的所有交互都封装在 `unsafe` 块中，因为它们是 FFI 调用。
            // 这些调用在主线程上是安全的。
            unsafe {
                let center = MPNowPlayingInfoCenter::defaultCenter();
                let playback_state = if playing {
                    MPNowPlayingPlaybackState::Playing
                } else {
                    MPNowPlayingPlaybackState::Paused
                };
                center.setPlaybackState(playback_state);
            }
        });
        Ok(())
    }

    /// 设置“正在播放”信息的标题。
    ///
    /// 此操作是异步的，会调度到主线程执行。
    fn set_title(&self, title: &str) -> anyhow::Result<()> {
        let title_owned = title.to_owned();
        Queue::main().exec_async(move || {
            // ## 安全性 (Safety)
            // `update_now_playing_info` 内部包含 FFI 调用，因此调用它需要 `unsafe` 块。
            // 我们在主线程上调用，是安全的。
            unsafe {
                update_now_playing_info(|info| {
                    let title_ns = NSString::from_str(&title_owned);
                    // `setValue:forKey:` 是 FFI 调用。
                    info.setValue_forKey(Some(&title_ns), MPMediaItemPropertyTitle);
                });
            }
        });
        Ok(())
    }

    /// 设置“正在播放”信息的艺术家。
    ///
    /// 此操作是异步的，会调度到主线程执行。
    fn set_artist(&self, artist: &str) -> anyhow::Result<()> {
        let artist_owned = artist.to_owned();
        Queue::main().exec_async(move || unsafe {
            update_now_playing_info(|info| {
                let artist_ns = NSString::from_str(&artist_owned);
                info.setValue_forKey(Some(&artist_ns), MPMediaItemPropertyArtist);
            });
        });
        Ok(())
    }

    /// 设置“正在播放”信息的总时长（秒）。
    ///
    /// 此操作是异步的，会调度到主线程执行。
    fn set_duration(&self, duration: f64) -> anyhow::Result<()> {
        Queue::main().exec_async(move || unsafe {
            update_now_playing_info(|info| {
                let duration_ns = NSNumber::new_f64(duration);
                info.setValue_forKey(Some(&duration_ns), MPMediaItemPropertyPlaybackDuration);
            });
        });
        Ok(())
    }

    /// 设置“正在播放”信息的当前播放位置（秒）。
    ///
    /// 此操作是异步的，会调度到主线程执行。
    fn set_position(&self, position: f64) -> anyhow::Result<()> {
        Queue::main().exec_async(move || unsafe {
            update_now_playing_info(|info| {
                let position_ns = NSNumber::new_f64(position);
                info.setValue_forKey(
                    Some(&position_ns),
                    MPNowPlayingInfoPropertyElapsedPlaybackTime,
                );
            });
        });
        Ok(())
    }

    /// 设置“正在播放”信息的封面图片。
    ///
    /// 接受一个包含图像数据（如 PNG 或 JPEG）的字节切片。
    /// 此操作是异步的，会调度到主线程执行。
    fn set_cover_image(&self, cover_data: impl AsRef<[u8]>) -> anyhow::Result<()> {
        let cover_data = cover_data.as_ref().to_vec();
        Queue::main().exec_async(move || {
            // 这里不需要 `unsafe` 块，因为 `update_now_playing_info` 的调用在闭包内部，
            // 而闭包本身已经是在 `unsafe` 上下文中被调用的。
            update_now_playing_info(|info| {
                // ## 安全性 (Safety)
                // 直接与 Objective-C 字典交互是 FFI 操作。
                if cover_data.is_empty() {
                    unsafe {
                        info.setValue_forKey(None, MPMediaItemPropertyArtwork);
                    }
                    return;
                }

                let data = NSData::from_vec(cover_data);
                if let Some(img) = NSImage::initWithData(NSImage::alloc(), &data) {
                    let img_size = unsafe { img.size() }; // FFI 调用
                    let artwork_alloc = MPMediaItemArtwork::alloc();

                    // 创建一个 Objective-C block 作为 request handler。
                    // 当系统需要显示封面图时，会调用这个 block。
                    let req_handler = block2::RcBlock::new(move |_: NSSize| -> NonNull<NSImage> {
                        // ## 安全性 (Safety)
                        // `Retained::as_ptr` 获取裸指针，然后我们通过 `NonNull::new(...).unwrap()`
                        // 将其转换回 `NonNull`。
                        // 这是不安全的，因为涉及裸指针操作。
                        // 我们能确保其安全，因为：
                        // 1. `img` 是一个有效的 `Retained<NSImage>` 对象，`as_ptr` 不会返回空指针。
                        // 2. `img` 被闭包捕获，其生命周期得以保证。
                        // 3. API 合约要求我们返回一个有效的 `NSImage` 指针。
                        let ptr = Retained::as_ptr(&img);
                        NonNull::new(ptr as *mut NSImage).unwrap()
                    });

                    // ## 安全性 (Safety)
                    // `initWithBoundsSize:requestHandler:` 是一个 FFI 调用。
                    // 我们能确保其安全，因为我们提供了有效的尺寸和 handler block。
                    let artwork = unsafe {
                        MPMediaItemArtwork::initWithBoundsSize_requestHandler(
                            artwork_alloc,
                            img_size,
                            &req_handler,
                        )
                    };

                    // ## 安全性 (Safety)
                    // `setValue:forKey:` 是 FFI 调用。
                    unsafe {
                        info.setValue_forKey(Some(&artwork), MPMediaItemPropertyArtwork);
                    }
                }
            });
        });
        Ok(())
    }

    /// 在 macOS 上，信息的更新是即时的，所以这个方法不需要做任何事情。
    fn update(&self) -> anyhow::Result<()> {
        Ok(())
    }
}

/// 一个辅助函数，用于安全地更新“正在播放”信息字典。
///
/// 它抽象了获取、修改、然后设置 `nowPlayingInfo` 的通用模式。
///
/// # Arguments
///
/// * `modifier` - 一个闭包，接收一个可变的 `NSMutableDictionary` 引用，并对其进行修改。
///
/// # Safety
///
/// 整个函数体被包裹在 `unsafe` 块中，因为它完全由对 Objective-C 运行时的 FFI 调用组成。
/// 调用者必须确保此函数在正确的线程（主线程）上执行。
fn update_now_playing_info<F>(modifier: F)
where
    F: FnOnce(&mut Retained<NSMutableDictionary<NSString, AnyObject>>),
{
    unsafe {
        // 获取 `MPNowPlayingInfoCenter` 的单例。
        let center = MPNowPlayingInfoCenter::defaultCenter();

        // 获取当前的 "nowPlayingInfo" 字典。如果不存在，则创建一个新的。
        let mut info = center
            .nowPlayingInfo()
            // 如果存在，就创建一个可变副本。
            .map(|d| d.mutableCopy())
            // 如果不存在（返回 nil），则创建一个全新的可变字典。
            .unwrap_or_else(|| {
                let dict: Retained<NSMutableDictionary<NSString, AnyObject>> =
                    NSMutableDictionary::new();
                // 默认设置媒体类型为音乐，这有助于系统更好地展示 UI。
                let media_type_val = NSNumber::new_usize(MPMediaType::Music.0);
                dict.setValue_forKey(Some(&*media_type_val), MPMediaItemPropertyMediaType);
                dict
            });

        // 调用传入的闭包，让调用者对字典进行具体的修改（如设置标题、艺术家等）。
        modifier(&mut info);

        // 将修改后的字典设置回 `MPNowPlayingInfoCenter`，以更新系统 UI。
        center.setNowPlayingInfo(Some(&info));
    }
}
