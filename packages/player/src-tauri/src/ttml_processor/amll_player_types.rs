use serde::{Deserialize, Serialize};

use crate::ttml_processor::types::{MetadataStripperOptions, SyllableSmoothingOptions};

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyricWord {
    pub start_time: u64,
    pub end_time: u64,
    pub word: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub words: Vec<LyricWord>,
    pub translated_lyric: String,
    pub roman_lyric: String,
    #[serde(rename = "isBG")]
    pub is_bg: bool,
    pub is_duet: bool,
    pub start_time: u64,
    pub end_time: u64,
}

#[derive(Serialize, Debug, Default)]
pub struct TTMLLyric {
    pub lines: Vec<LyricLine>,
    pub metadata: Vec<(String, Vec<String>)>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcessorChainOptions {
    #[serde(default)]
    pub apply_auto_splitting: bool,
    #[serde(default)]
    pub chinese_conversion_mode: String,
    #[serde(default)]
    pub metadata_stripper: MetadataStripperOptions,
    #[serde(default)]
    pub smoothing: Option<SyllableSmoothingOptions>,
    #[serde(default)]
    pub agent_recognizer: AgentRecognizerOptions,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecognizerOptions {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub custom_pattern: Option<String>,
    #[serde(default = "default_true")]
    pub case_sensitive: bool,
    #[serde(default = "default_true")]
    pub inherit_agent: bool,
    #[serde(default = "default_true")]
    pub remove_marker_lines: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AgentRecognizerOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            custom_pattern: None,
            case_sensitive: true,
            inherit_agent: true,
            remove_marker_lines: true,
        }
    }
}
