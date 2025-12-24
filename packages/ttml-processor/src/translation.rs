use lyrics_helper_core::converter::types as helper_types;
use std::collections::HashMap;

use crate::{JsLyricLine, JsLyricWord};

const CHORUS_AGENT_ID: &str = "v1000";
const PREFERRED_TRANSLATION_LANG: &str = "zh-CN";

fn get_track_text(track: &helper_types::LyricTrack) -> String {
    track
        .words
        .iter()
        .flat_map(|word| &word.syllables)
        .map(|syl| {
            if syl.ends_with_space {
                format!("{} ", syl.text)
            } else {
                syl.text.clone()
            }
        })
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn extract_line_components(
    syllables: &[helper_types::LyricSyllable],
    translations: &[helper_types::LyricTrack],
    romanizations: &[helper_types::LyricTrack],
    is_instrumental: bool,
) -> (Vec<JsLyricWord>, String, String) {
    let mut line_romanization = String::new();
    let mut syllables_romanizations = romanizations;

    if let Some(first_track) = romanizations.first() {
        let all_roma_syllables: Vec<_> = first_track
            .words
            .iter()
            .flat_map(|w| &w.syllables)
            .collect();

        if all_roma_syllables.len() == 1
            && let Some(syl) = all_roma_syllables.first()
            && syl.start_ms == 0
            && syl.end_ms == 0
        {
            line_romanization.clone_from(&syl.text);
            syllables_romanizations = &[];
        }
    }

    let roman_syllables: Vec<_> = syllables_romanizations
        .first()
        .map(|track| {
            track
                .words
                .iter()
                .flat_map(|w| &w.syllables)
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut roman_groups: Vec<Vec<String>> = vec![Vec::new(); syllables.len()];

    if !roman_syllables.is_empty() && !syllables.is_empty() {
        for roman_syl in &roman_syllables {
            let mut best_match_index = None;
            let mut max_overlap: i64 = 0;

            for (i, main_syl) in syllables.iter().enumerate() {
                let overlap = std::cmp::min(main_syl.end_ms, roman_syl.end_ms) as i64
                    - std::cmp::max(main_syl.start_ms, roman_syl.start_ms) as i64;

                if overlap > max_overlap {
                    max_overlap = overlap;
                    best_match_index = Some(i);
                }
            }

            if let Some(index) = best_match_index {
                roman_groups[index].push(roman_syl.text.clone());
            } else {
                // warn!(
                //     "未匹配的罗马音音节 '{}', {}ms - {}ms",
                //     roman_syl.text, roman_syl.start_ms, roman_syl.end_ms
                // );
            }
        }
    }

    let words = syllables
        .iter()
        .enumerate()
        .map(|(i, syllable)| {
            let word_text = if syllable.ends_with_space {
                format!("{} ", syllable.text)
            } else {
                syllable.text.clone()
            };

            let end_time = if is_instrumental {
                // 应对纯音乐提示文本
                syllable.start_ms + 3_600_000 // 1 h
            } else {
                syllable.end_ms
            };

            let roman_word_text = roman_groups[i].join("");

            JsLyricWord {
                start_time: syllable.start_ms as f64,
                end_time: end_time as f64,
                word: word_text,
                roman_word: roman_word_text,
            }
        })
        .collect();

    let mut translation = translations
        .iter()
        .find(|t| {
            t.metadata
                .get(&helper_types::TrackMetadataKey::Language)
                .is_some_and(|lang| lang.eq_ignore_ascii_case(PREFERRED_TRANSLATION_LANG))
        })
        .or_else(|| translations.first())
        .map_or(String::new(), get_track_text);

    if translation == "//" {
        translation = String::new();
    }

    let romanization = line_romanization;

    (words, translation, romanization)
}

#[allow(clippy::too_many_lines)]
pub fn convert_to_amll_lyrics(source_data: &helper_types::ParsedSourceData) -> Vec<JsLyricLine> {
    let is_instrumental = if source_data.lines.len() == 1 {
        source_data
            .lines
            .first()
            .and_then(|line| {
                line.tracks
                    .iter()
                    .find(|t| t.content_type == helper_types::ContentType::Main)
            })
            .is_some_and(|main_track| {
                main_track
                    .content
                    .words
                    .iter()
                    .flat_map(|w| &w.syllables)
                    .count()
                    == 1
            })
    } else {
        false
    };

    let mut agent_duet_map: HashMap<String, bool> = HashMap::new();

    source_data
        .lines
        .iter()
        .flat_map(|helper_line| {
            let current_line_is_duet = match helper_line.agent.as_deref() {
                None | Some(CHORUS_AGENT_ID) => false,
                // AMLL 的对唱标识
                Some("v2") => true,
                Some(agent_id) => agent_duet_map.get(agent_id).copied().unwrap_or_else(|| {
                    // 为新出现的 agent 交替分配 `false` 和 `true`。
                    // 上层已对歌词行进行排序，所以这里不需要排序。
                    let new_duet_status = !agent_duet_map.len().is_multiple_of(2);
                    agent_duet_map.insert(agent_id.to_string(), new_duet_status);
                    new_duet_status
                }),
            };

            let main_annotated_track = helper_line
                .tracks
                .iter()
                .find(|t| t.content_type == helper_types::ContentType::Main);

            let mut main_line = main_annotated_track.and_then(|main_track| {
                let main_syllables: Vec<_> = main_track
                    .content
                    .words
                    .iter()
                    .flat_map(|w| &w.syllables)
                    .cloned()
                    .collect();

                if main_syllables.is_empty() {
                    return None;
                }

                let (words, translated_lyric, roman_lyric) = extract_line_components(
                    &main_syllables,
                    &main_track.translations,
                    &main_track.romanizations,
                    is_instrumental,
                );

                let start_time = words
                    .iter()
                    .map(|s| s.start_time)
                    .fold(f64::INFINITY, f64::min);

                let end_time = words
                    .iter()
                    .map(|s| s.end_time)
                    .fold(f64::NEG_INFINITY, f64::max);

                let final_start = if start_time.is_infinite() {
                    helper_line.start_ms as f64
                } else {
                    start_time
                };
                let final_end = if end_time.is_infinite() {
                    helper_line.end_ms as f64
                } else {
                    end_time
                };

                Some(JsLyricLine {
                    start_time: final_start,
                    end_time: final_end,
                    words,
                    translated_lyric,
                    roman_lyric,
                    is_bg: false,
                    is_duet: current_line_is_duet,
                })
            });

            let background_annotated_track = helper_line
                .tracks
                .iter()
                .find(|t| t.content_type == helper_types::ContentType::Background);

            let bg_line = background_annotated_track.and_then(|bg_track| {
                let bg_syllables: Vec<_> = bg_track
                    .content
                    .words
                    .iter()
                    .flat_map(|w| &w.syllables)
                    .cloned()
                    .collect();
                if bg_syllables.is_empty() {
                    return None;
                }

                let (bg_words, bg_translation, bg_romanization) = extract_line_components(
                    &bg_syllables,
                    &bg_track.translations,
                    &bg_track.romanizations,
                    false,
                );

                let start_time = bg_words
                    .iter()
                    .map(|s| s.start_time)
                    .fold(f64::INFINITY, f64::min);
                let end_time = bg_words
                    .iter()
                    .map(|s| s.end_time)
                    .fold(f64::NEG_INFINITY, f64::max);

                let final_start = if start_time.is_infinite() {
                    helper_line.start_ms as f64
                } else {
                    start_time
                };
                let final_end = if end_time.is_infinite() {
                    helper_line.end_ms as f64
                } else {
                    end_time
                };

                Some(JsLyricLine {
                    start_time: final_start,
                    end_time: final_end,
                    words: bg_words,
                    translated_lyric: bg_translation,
                    roman_lyric: bg_romanization,
                    is_bg: true,
                    is_duet: current_line_is_duet,
                })
            });

            if let (Some(main), Some(bg)) = (&mut main_line, &bg_line)
                && bg.end_time > main.end_time
            {
                main.end_time = bg.end_time;
            }

            main_line.into_iter().chain(bg_line)
        })
        .collect()
}
