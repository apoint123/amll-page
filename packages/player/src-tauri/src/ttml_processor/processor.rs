use std::collections::HashMap;

use crate::ttml_processor::{
    agent_recognizer,
    amll_player_types::{self, ProcessorChainOptions, TTMLLyric},
    chinese_conversion_processor::ChineseConversionProcessor,
    lyric_optimizer, metadata_stripper, ttml_parser,
    types::{ChineseConversionOptions, DefaultLanguageOptions, LyricLine},
    utils::apply_auto_word_splitting,
};

use tauri::command;

fn get_config_name_from_mode(mode: &str) -> Option<String> {
    match mode {
        "s2t" => Some("s2t.json".to_string()),
        "t2s" => Some("t2s.json".to_string()),
        "s2tw" => Some("s2tw.json".to_string()),
        "tw2s" => Some("tw2s.json".to_string()),
        "s2hk" => Some("s2hk.json".to_string()),
        "hk2s" => Some("hk2s.json".to_string()),
        _ => None,
    }
}

fn standardize_agent_ids(lines: &mut [LyricLine]) {
    let mut name_to_id_map = HashMap::new();
    let mut next_agent_num = 1;
    const CHORUS_KEYWORDS: &[&str] = &["合", "合唱", "All"];

    for line in lines.iter_mut() {
        if let Some(agent_name) = line.agent.clone() {
            if CHORUS_KEYWORDS
                .iter()
                .any(|&keyword| keyword.eq_ignore_ascii_case(&agent_name))
            {
                line.agent = Some("v1000".to_string());
                continue;
            }

            let id = name_to_id_map.entry(agent_name).or_insert_with(|| {
                let new_id = format!("v{}", next_agent_num);
                next_agent_num += 1;
                new_id
            });

            line.agent = Some(id.clone());
        }
    }
}

fn assign_duet_view(lines: &[LyricLine]) -> HashMap<String, bool> {
    let mut agent_to_duet_map = HashMap::new();
    let mut last_duet_status = true;

    for line in lines {
        if let Some(agent_id) = line.agent.as_ref() {
            if agent_id == "v1000" {
                continue;
            }

            agent_to_duet_map
                .entry(agent_id.clone())
                .or_insert_with(|| {
                    last_duet_status = !last_duet_status;
                    last_duet_status
                });
        }
    }
    agent_to_duet_map
}

#[command]
pub fn parse_ttml_for_amll_player(
    src: &str,
    options: ProcessorChainOptions,
) -> Result<TTMLLyric, String> {
    let mut parsed_data = ttml_parser::parse_ttml(src, &DefaultLanguageOptions::default())
        .map_err(|e| e.to_string())?;

    if options.metadata_stripper.enabled {
        metadata_stripper::strip_descriptive_metadata_lines(
            &mut parsed_data.lines,
            &options.metadata_stripper,
        );
    }

    let has_agents = parsed_data
        .lines
        .iter()
        .any(|line| line.agent.as_deref() != Some("v1"));

    if !has_agents && options.agent_recognizer.enabled {
        agent_recognizer::recognize_agents(&mut parsed_data.lines, &options.agent_recognizer);
        standardize_agent_ids(&mut parsed_data.lines);
    }

    let duet_map = assign_duet_view(&parsed_data.lines);

    if options.apply_auto_splitting {
        apply_auto_word_splitting(&mut parsed_data);
    }

    if let Some(smoothing_options) = &options.smoothing {
        lyric_optimizer::apply_smoothing(&mut parsed_data.lines, smoothing_options);
    }

    if let Some(config_name) = get_config_name_from_mode(&options.chinese_conversion_mode) {
        let cc_options = ChineseConversionOptions {
            config_name: Some(config_name),
        };

        let cc_processor = ChineseConversionProcessor::new();
        cc_processor.process(&mut parsed_data.lines, &cc_options);
    }

    let final_lines: Vec<amll_player_types::LyricLine> = parsed_data
        .lines
        .into_iter()
        .flat_map(|rust_line| {
            let mut lines_for_frontend = Vec::new();
            let mut last_main_line_is_duet = false;

            let main_line_words: Vec<_> = rust_line
                .main_syllables
                .iter()
                .map(|s| amll_player_types::LyricWord {
                    start_time: s.start_ms,
                    end_time: s.end_ms,
                    word: if s.ends_with_space {
                        format!("{} ", s.text)
                    } else {
                        s.text.clone()
                    },
                })
                .collect();

            if !main_line_words.is_empty() {
                let is_duet = rust_line
                    .agent
                    .as_ref()
                    .and_then(|id| duet_map.get(id).copied())
                    .unwrap_or(false);

                last_main_line_is_duet = is_duet;

                lines_for_frontend.push(amll_player_types::LyricLine {
                    words: main_line_words,
                    translated_lyric: rust_line
                        .translations
                        .iter()
                        .map(|t| t.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" / "),
                    roman_lyric: rust_line
                        .romanizations
                        .iter()
                        .map(|r| r.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" / "),
                    is_bg: false,
                    is_duet,
                    start_time: rust_line.start_ms,
                    end_time: rust_line.end_ms,
                });
            }

            if let Some(bg_section) = rust_line.background_section {
                let bg_line_words: Vec<_> = bg_section
                    .syllables
                    .into_iter()
                    .map(|s| amll_player_types::LyricWord {
                        start_time: s.start_ms,
                        end_time: s.end_ms,
                        word: if s.ends_with_space {
                            format!("{} ", s.text)
                        } else {
                            s.text
                        },
                    })
                    .collect();

                if !bg_line_words.is_empty() {
                    lines_for_frontend.push(amll_player_types::LyricLine {
                        words: bg_line_words,
                        translated_lyric: bg_section
                            .translations
                            .iter()
                            .map(|t| t.text.as_str())
                            .collect::<Vec<_>>()
                            .join(" / "),
                        roman_lyric: bg_section
                            .romanizations
                            .iter()
                            .map(|r| r.text.as_str())
                            .collect::<Vec<_>>()
                            .join(" / "),
                        is_bg: true,
                        is_duet: last_main_line_is_duet,
                        start_time: bg_section.start_ms,
                        end_time: bg_section.end_ms,
                    });
                }
            }

            lines_for_frontend
        })
        .collect();

    let final_metadata: Vec<(String, Vec<String>)> = parsed_data.raw_metadata.into_iter().collect();

    Ok(TTMLLyric {
        lines: final_lines,
        metadata: final_metadata,
    })
}
