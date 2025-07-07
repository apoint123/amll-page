use regex::{Regex, RegexBuilder};
use std::borrow::Cow;

use crate::ttml_processor::{amll_player_types::AgentRecognizerOptions, types::LyricLine};

fn get_agent_regex(options: &AgentRecognizerOptions) -> Regex {
    const DEFAULT_PATTERN: &str = r"^\s*(?:\((.+?)\)|（(.+?)）|([^\s:()（）]+))\s*[:：]\s*";

    let pattern = options.custom_pattern.as_deref().unwrap_or(DEFAULT_PATTERN);

    RegexBuilder::new(pattern)
        .case_insensitive(!options.case_sensitive)
        .build()
        .unwrap()
}

pub fn recognize_agents(lines: &mut Vec<LyricLine>, options: &AgentRecognizerOptions) {
    if !options.enabled {
        return;
    }

    let agent_regex = get_agent_regex(options);
    let original_lines = std::mem::take(lines);
    let mut processed_lines = Vec::with_capacity(original_lines.len());
    let mut current_agent: Option<String> = None;

    for mut line in original_lines {
        let full_text: Cow<str> = get_line_text(&line);

        if let Some(captures) = agent_regex.captures(&full_text) {
            let agent_name = captures
                .get(1)
                .or_else(|| captures.get(2))
                .or_else(|| captures.get(3))
                .map(|m| m.as_str().trim().to_string());

            if let (Some(name), Some(full_match_capture)) = (agent_name, captures.get(0)) {
                let full_match_str = full_match_capture.as_str().to_string();

                if let Some(remaining_text) = full_text.strip_prefix(&full_match_str) {
                    let trimmed_remaining = remaining_text.trim();

                    if trimmed_remaining.is_empty() {
                        current_agent = Some(name);
                        if options.remove_marker_lines {
                            continue;
                        }
                    } else {
                        line.agent = Some(name.clone());
                        current_agent = Some(name);
                    }
                    clean_line_text(&mut line, &full_match_str);
                }
            } else {
                if options.inherit_agent {
                    line.agent = current_agent.clone();
                }
            }
        } else {
            if options.inherit_agent {
                line.agent = current_agent.clone();
            }
        }

        processed_lines.push(line);
    }

    *lines = processed_lines;
}

fn get_line_text<'a>(line: &'a LyricLine) -> Cow<'a, str> {
    if let Some(text) = &line.line_text {
        Cow::Borrowed(text)
    } else {
        let collected_string: String = line
            .main_syllables
            .iter()
            .map(|s| s.text.as_str())
            .collect();
        Cow::Owned(collected_string)
    }
}

fn clean_line_text(line: &mut LyricLine, prefix_to_remove: &str) {
    if !line.main_syllables.is_empty() {
        let mut len_to_remove = prefix_to_remove.len();
        let mut syllables_to_drain = 0;

        for syllable in &line.main_syllables {
            if len_to_remove >= syllable.text.len() {
                len_to_remove -= syllable.text.len();
                syllables_to_drain += 1;
            } else {
                break;
            }
        }

        if syllables_to_drain > 0 {
            line.main_syllables.drain(0..syllables_to_drain);
        }

        if len_to_remove > 0 {
            if let Some(first_syllable) = line.main_syllables.get_mut(0) {
                if len_to_remove < first_syllable.text.len() {
                    first_syllable.text = first_syllable.text[len_to_remove..].to_string();
                } else {
                    line.main_syllables.remove(0);
                }
            }
        }
    }

    if let Some(text) = line.line_text.as_mut() {
        if text.starts_with(prefix_to_remove) {
            *text = text[prefix_to_remove.len()..].to_string();
        } else {
            if !line.main_syllables.is_empty() {
                *text = line
                    .main_syllables
                    .iter()
                    .map(|s| s.text.as_str())
                    .collect();
            }
        }
    }
}
