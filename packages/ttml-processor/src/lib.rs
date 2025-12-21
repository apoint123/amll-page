use lyrics_helper_core::TtmlParsingOptions;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::translation::convert_to_amll_lyrics;

mod translation;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsLyricWord {
    pub start_time: f64,
    pub end_time: f64,
    pub word: String,
    pub roman_word: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsLyricLine {
    pub words: Vec<JsLyricWord>,
    pub translated_lyric: String,
    pub roman_lyric: String,
    pub start_time: f64,
    pub end_time: f64,
    #[serde(rename = "isBG")]
    pub is_bg: bool,
    pub is_duet: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct JsTTMLLyric {
    pub lines: Vec<JsLyricLine>,
    pub metadata: Vec<(String, Vec<String>)>,
}

#[wasm_bindgen]
#[allow(clippy::missing_const_for_fn)]
pub fn init() {
    // console_error_panic_hook::set_once();
}

/// 使用 `ttml_processor` 解析一份 TTML 文件，并返回 AMLL 的数据结构
///
/// # Returns
///
/// * `Result<JsValue, JsValue>` -
///     * **Success**: 返回一个 JavaScript 数组对象，对应 AMLL 的 `TTMLLyric[]`
///     * **Error**: 返回一个 JavaScript 字符串，描述解析过程中发生的错误
///
/// # Errors
/// 会在以下情况下返回错误:
/// * `ConvertError::Xml` - 当输入的 TTML 内容不是有效的 XML 格式时
/// * `ConvertError::InvalidTime` - 当 TTML 中的时间戳格式无效或无法解析时
/// * `ConvertError::Internal` - 当内部处理过程中出现意外错误时（如上下文丢失）
/// * `Serialization Error` - 序列化数据失败，通常不应该发生
#[wasm_bindgen]
pub fn parse_ttml(ttml_content: &str) -> Result<JsValue, JsValue> {
    let parsing_options = TtmlParsingOptions::default();

    let parsed_data = ttml_processor::parse_ttml(ttml_content, &parsing_options)
        .map_err(|e| JsValue::from_str(&format!("TTML Parse Error: {e:?}")))?;

    let simple_lines = convert_to_amll_lyrics(&parsed_data);

    let metadata: Vec<(String, Vec<String>)> = parsed_data.raw_metadata.into_iter().collect();

    let result = JsTTMLLyric {
        lines: simple_lines,
        metadata,
    };

    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    let js_result = result
        .serialize(&serializer)
        .map_err(|e| JsValue::from_str(&format!("Serialization Error: {e:?}")))?;

    Ok(js_result)
}
