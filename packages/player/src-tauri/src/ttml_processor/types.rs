use std::{collections::HashMap, fmt};

use quick_xml::{
    Error as QuickXmlErrorMain, encoding::EncodingError,
    events::attributes::AttrError as QuickXmlAttrError,
};
use serde::{Deserialize, Serialize};
use strum_macros::EnumString;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConvertError {
    #[error("生成 XML 错误: {0}")]
    Xml(#[from] QuickXmlErrorMain),
    #[error("XML 属性错误: {0}")]
    Attribute(#[from] QuickXmlAttrError),
    #[error("解析错误: {0}")]
    ParseInt(#[from] std::num::ParseIntError),
    #[error("无效的时间格式: {0}")]
    InvalidTime(String),
    #[error("格式错误: {0}")]
    Format(#[from] std::fmt::Error),
    #[error("错误: {0}")]
    Internal(String),
    #[error("Base64 解码错误: {0}")]
    Base64Decode(#[from] base64::DecodeError),
    #[error("UTF-8 转换错误: {0}")]
    FromUtf8(#[from] std::string::FromUtf8Error),
    #[error("文本编码或解码错误: {0}")]
    Encoding(#[from] EncodingError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, EnumString, Serialize, Deserialize)]
#[strum(ascii_case_insensitive)]
#[derive(Default)]
pub enum LyricFormat {
    /// Timed Text Markup Language 格式。
    #[default]
    Ttml,
}

impl fmt::Display for LyricFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LyricFormat::Ttml => write!(f, "TTML"),
        }
    }
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LyricSyllable {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub duration_ms: Option<u64>,
    pub ends_with_space: bool,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranslationEntry {
    pub text: String,
    pub lang: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct RomanizationEntry {
    pub text: String,
    pub lang: Option<String>,
    pub scheme: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackgroundSection {
    pub start_ms: u64,
    pub end_ms: u64,
    pub syllables: Vec<LyricSyllable>,
    pub translations: Vec<TranslationEntry>,
    pub romanizations: Vec<RomanizationEntry>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct LyricLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub line_text: Option<String>,
    pub main_syllables: Vec<LyricSyllable>,
    pub translations: Vec<TranslationEntry>,
    pub romanizations: Vec<RomanizationEntry>,
    pub agent: Option<String>,
    pub background_section: Option<BackgroundSection>,
    pub song_part: Option<String>,
    pub itunes_key: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedSourceData {
    pub lines: Vec<LyricLine>,
    pub raw_metadata: HashMap<String, Vec<String>>,
    pub source_format: LyricFormat,
    pub source_filename: Option<String>,
    pub is_line_timed_source: bool,
    pub warnings: Vec<String>,
    pub raw_ttml_from_input: Option<String>,
    pub detected_formatted_ttml_input: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DefaultLanguageOptions {
    pub main: Option<String>,
    pub translation: Option<String>,
    pub romanization: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataStripperOptions {
    pub enabled: bool,
    pub keywords: Option<Vec<String>>,
    pub keyword_case_sensitive: bool,
    pub enable_regex_stripping: bool,
    pub regex_patterns: Option<Vec<String>>,
    pub regex_case_sensitive: bool,
}

impl Default for MetadataStripperOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            keywords: None,
            keyword_case_sensitive: false,
            enable_regex_stripping: true,
            regex_patterns: None,
            regex_case_sensitive: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChineseConversionOptions {
    pub config_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SmoothingMode {
    #[default]
    Global,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SyllableSmoothingOptions {
    pub factor: f64,
    pub duration_threshold_ms: u64,
    pub gap_threshold_ms: u64,
    pub smoothing_iterations: u32,
}

impl Default for SyllableSmoothingOptions {
    fn default() -> Self {
        Self {
            factor: 0.15,
            duration_threshold_ms: 50,
            gap_threshold_ms: 100,
            smoothing_iterations: 5,
        }
    }
}
