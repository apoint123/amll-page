use std::{
    collections::{HashMap, HashSet},
    str,
    sync::OnceLock,
};

use quick_xml::{
    events::{attributes::Attribute, BytesEnd, BytesStart, BytesText, Event},
    Reader,
};
use regex::Regex;
use tracing::{error, warn};

use crate::ttml_processor::types::{
    BackgroundSection, ConvertError, DefaultLanguageOptions, LyricFormat, LyricLine, LyricSyllable,
    ParsedSourceData, RomanizationEntry, TranslationEntry,
};

// =================================================================================
// 1. 常量定义 (Constants)
//
// 为了性能和代码清晰度，将所有用到的 XML 标签和属性名定义为字节切片常量。
// 这样可以避免在解析循环中反复创建字符串，并能直接与 quick-xml 的字节事件进行比较。
// =================================================================================

// --- XML 标签名常量 ---
const TAG_TT: &[u8] = b"tt";
const TAG_METADATA: &[u8] = b"metadata";
const TAG_BODY: &[u8] = b"body";
const TAG_DIV: &[u8] = b"div";
const TAG_P: &[u8] = b"p";
const TAG_SPAN: &[u8] = b"span";
const TAG_BR: &[u8] = b"br";
const TAG_META: &[u8] = b"meta";
const TAG_ITUNES_METADATA: &[u8] = b"iTunesMetadata";
const TAG_TRANSLATIONS: &[u8] = b"translations";
const TAG_TRANSLATION: &[u8] = b"translation";
const TAG_TEXT: &[u8] = b"text";
const TAG_SONGWRITERS: &[u8] = b"songwriters";
const TAG_SONGWRITER: &[u8] = b"songwriter";
const TAG_AGENT: &[u8] = b"agent";
const TAG_NAME: &[u8] = b"name";

// --- XML 属性名常量 ---
const ATTR_ITUNES_TIMING: &[u8] = b"itunes:timing";
const ATTR_XML_LANG: &[u8] = b"xml:lang";
const ATTR_ITUNES_SONG_PART: &[u8] = b"itunes:song-part";
const ATTR_BEGIN: &[u8] = b"begin";
const ATTR_END: &[u8] = b"end";
const ATTR_AGENT: &[u8] = b"ttm:agent";
const ATTR_AGENT_ALIAS: &[u8] = b"agent";
const ATTR_ITUNES_KEY: &[u8] = b"itunes:key";
const ATTR_ROLE: &[u8] = b"ttm:role";
const ATTR_ROLE_ALIAS: &[u8] = b"role";
const ATTR_KEY: &[u8] = b"key";
const ATTR_VALUE: &[u8] = b"value";
const ATTR_FOR: &[u8] = b"for";
const ATTR_XML_ID: &[u8] = b"xml:id";
const ATTR_TYPE: &[u8] = b"type";
const ATTR_XML_SCHEME: &[u8] = b"xml:scheme";

// --- XML 属性值常量 ---
const ROLE_TRANSLATION: &[u8] = b"x-translation";
const ROLE_ROMANIZATION: &[u8] = b"x-roman";
const ROLE_BACKGROUND: &[u8] = b"x-bg";

// =================================================================================
// 2. 解析器状态结构体 (Parser State Structs)
// =================================================================================

/// 主解析器状态机，聚合了所有子状态和全局配置。
#[derive(Debug, Default)]
struct TtmlParserState {
    // --- 全局配置与状态 ---
    /// 是否为逐行计时模式。由 `<tt itunes:timing="line">` 或自动检测确定。
    is_line_timing_mode: bool,
    /// 标记是否是通过启发式规则（没有找到带时间的span）自动检测为逐行模式。
    detected_line_mode: bool,
    /// 默认的主要语言。
    default_main_lang: Option<String>,
    /// 默认的翻译语言。
    default_translation_lang: Option<String>,
    /// 默认的罗马音语言。
    default_romanization_lang: Option<String>,
    /// 用于存储和检查 `xml:id` 的唯一性，防止重复。
    xml_ids: HashSet<String>,
    /// 通用文本缓冲区，用于临时存储标签内的文本内容。
    text_buffer: String,

    // --- 子状态机 ---
    /// 标记当前解析位置是否在 `<metadata>` 标签内。
    in_metadata_section: bool,
    /// 存储 `<metadata>` 区域解析状态的结构体。
    metadata_state: MetadataParseState,
    /// 存储 `<body>` 和 `<p>` 区域解析状态的结构体。
    body_state: BodyParseState,
}

/// 存储 `<metadata>` 区域解析状态的结构体。
#[derive(Debug, Default)]
struct MetadataParseState {
    // --- Apple Music 特定元数据状态 ---
    in_itunes_metadata: bool,
    in_am_translations: bool, // AM = Apple Music
    in_am_translation: bool,
    current_am_translation_lang: Option<String>,
    /// 存储从 `<iTunesMetadata>` 解析出的翻译，key 是 itunes:key。
    translation_map: HashMap<String, (String, Option<String>)>,
    in_songwriters_tag: bool,
    in_songwriter_tag: bool,
    current_songwriter_name: String,

    // --- ttm:agent (演唱者) 相关状态 ---
    in_agent_tag: bool,
    in_agent_name_tag: bool,
    current_agent_id_for_name: Option<String>,
    current_agent_name_text: String,

    // --- 通用 ttm: 命名空间元数据状态 ---
    in_ttm_metadata_tag: bool,
    current_ttm_metadata_key: Option<String>,
}

/// 存储 `<body>` 和 `<p>` 区域解析状态的结构体。
#[derive(Debug, Default)]
struct BodyParseState {
    in_body: bool,
    in_div: bool,
    in_p: bool,
    /// 当前 `<div>` 的 `itunes:song-part` 属性，会被子 `<p>` 继承。
    current_div_song_part: Option<String>,
    /// 存储当前正在处理的 `<p>` 元素的临时数据。
    current_p_element_data: Option<CurrentPElementData>,
    /// `<span>` 标签的上下文堆栈，用于处理嵌套的 span。
    span_stack: Vec<SpanContext>,
    /// 记录上一个处理的音节信息，主要用于判断音节间的空格。
    last_syllable_info: LastSyllableInfo,
}

/// 存储当前处理的 `<p>` 元素解析过程中的临时数据。
#[derive(Debug, Default, Clone)]
struct CurrentPElementData {
    start_ms: u64,
    end_ms: u64,
    agent: Option<String>,
    song_part: Option<String>, // 继承自 div 或 p 自身
    itunes_key: Option<String>,
    /// 用于在逐行模式下累积所有文本内容。
    line_text_accumulator: String,
    /// 用于在逐字模式下累积所有音节。
    syllables_accumulator: Vec<LyricSyllable>,
    /// 用于累积当前行内的所有翻译。
    translations_accumulator: Vec<TranslationEntry>,
    /// 用于累积当前行内的所有罗马音。
    romanizations_accumulator: Vec<RomanizationEntry>,
    /// 用于累积当前行内的背景人声部分。
    background_section_accumulator: Option<BackgroundSectionData>,
}

/// 存储当前处理的 `<span ttm:role="x-bg">` (背景人声) 的临时数据。
#[derive(Debug, Default, Clone)]
struct BackgroundSectionData {
    start_ms: u64,
    end_ms: u64,
    syllables: Vec<LyricSyllable>,
    translations: Vec<TranslationEntry>,
    romanizations: Vec<RomanizationEntry>,
}

/// 代表当前 `<span>` 的上下文信息，用于处理嵌套和内容分类。
#[derive(Debug, Clone)]
struct SpanContext {
    role: SpanRole,
    lang: Option<String>,   // xml:lang 属性
    scheme: Option<String>, // xml:scheme 属性
    start_ms: Option<u64>,
    end_ms: Option<u64>,
}

/// 定义 `<span>` 标签可能扮演的角色。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpanRole {
    /// 普通音节
    Generic,
    /// 翻译    
    Translation,
    /// 罗马音
    Romanization,
    /// 背景人声容器
    Background,
}

/// 记录最后一个结束的音节信息，用于正确处理音节间的空格。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum LastSyllableInfo {
    #[default]
    /// 初始状态或上一个不是音节
    None,
    EndedSyllable {
        /// 标记这个音节是否属于背景人声
        was_background: bool,
    },
}

// =================================================================================
// 3. 公共 API (Public API)
// =================================================================================

/// 解析 TTML 格式的歌词文件。
///
/// 这是模块对外暴露的主函数。
///
/// # 参数
///
/// * `content` - TTML 格式的歌词文件内容字符串。
/// * `default_languages` - 当 TTML 文件中未指定语言时，使用的默认语言配置。
///
/// # 返回
///
/// * `Ok(ParsedSourceData)` - 成功解析后，返回包含歌词行、元数据等信息的统一数据结构。
/// * `Err(ConvertError)` - 解析失败时，返回具体的错误信息。
pub fn parse_ttml(
    content: &str,
    default_languages: &DefaultLanguageOptions,
) -> Result<ParsedSourceData, ConvertError> {
    // 预扫描以确定是否存在带时间的span，辅助判断计时模式
    static TIMED_SPAN_RE: OnceLock<Regex> = OnceLock::new();
    let timed_span_re =
        TIMED_SPAN_RE.get_or_init(|| Regex::new(r#"<span\s+[^>]*begin\s*="#).unwrap());
    let has_timed_span_tags = timed_span_re.is_match(content);

    // 初始化 quick-xml 读取器
    let mut reader = Reader::from_str(content);
    let config = reader.config_mut();
    // 配置读取器不自动裁剪文本前后空白，因为我们需要精确控制文本内容。
    config.trim_text(false);
    config.expand_empty_elements = true;

    // 初始化最终要返回的数据容器
    let mut lines: Vec<LyricLine> = Vec::new();
    let mut raw_metadata: HashMap<String, Vec<String>> = HashMap::new();
    let mut warnings: Vec<String> = Vec::new();

    // 初始化解析状态机
    let mut state = TtmlParserState {
        default_main_lang: default_languages.main.clone(),
        default_translation_lang: default_languages.translation.clone(),
        default_romanization_lang: default_languages.romanization.clone(),
        ..Default::default()
    };
    let mut buf = Vec::new();

    // --- 主循环：通过读取 XML 事件来驱动解析过程 ---
    loop {
        match reader.read_event_into(&mut buf) {
            // 到达文件末尾，跳出循环
            Ok(Event::Eof) => break,
            Ok(event) => {
                // 根据当前上下文（状态），将事件分发给不同的处理器
                if state.body_state.in_p {
                    handle_p_event(&event, &mut state, &reader, &mut lines, &mut warnings)?;
                } else if state.in_metadata_section {
                    handle_metadata_event(
                        &event,
                        &mut state,
                        &mut reader,
                        &mut raw_metadata,
                        &mut warnings,
                    )?;
                } else {
                    handle_global_event(
                        &event,
                        &mut state,
                        &reader,
                        &mut raw_metadata,
                        &mut warnings,
                        has_timed_span_tags,
                    )?;
                }
            }
            Err(e) => {
                // XML 格式本身有误，这是无法恢复的错误
                error!("TTML 解析错误，位置 {}: {}", reader.buffer_position(), e);
                return Err(ConvertError::Xml(e));
            }
        }
        buf.clear(); // 清空缓冲区为下一次读取做准备
    }

    Ok(ParsedSourceData {
        lines,
        raw_metadata,
        source_format: LyricFormat::Ttml,
        source_filename: None,
        is_line_timed_source: state.is_line_timing_mode,
        warnings,
        raw_ttml_from_input: Some(content.to_string()),
        detected_formatted_ttml_input: None,
    })
}

// =================================================================================
// 4. 核心事件分发器 (Core Event Dispatchers)
// =================================================================================

/// 处理全局事件（在 `<p>` 或 `<metadata>` 之外的事件）。
/// 主要负责识别文档的根元素、body、div 和 p 的开始，并相应地更新状态。
fn handle_global_event<'a>(
    event: &Event<'a>,
    state: &mut TtmlParserState,
    reader: &Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    warnings: &mut Vec<String>,
    has_timed_span_tags: bool,
) -> Result<(), ConvertError> {
    match event {
        Event::Start(e) => match e.local_name().as_ref() {
            TAG_TT => process_tt_start(
                e,
                state,
                raw_metadata,
                reader,
                has_timed_span_tags,
                warnings,
            )?,
            TAG_METADATA => state.in_metadata_section = true,
            TAG_BODY => state.body_state.in_body = true,
            TAG_DIV if state.body_state.in_body => {
                state.body_state.in_div = true;
                // 获取 song-part
                state.body_state.current_div_song_part = e
                    .try_get_attribute(ATTR_ITUNES_SONG_PART)?
                    .map(|attr| attr_value_as_string(&attr, reader))
                    .transpose()?;
            }
            TAG_P if state.body_state.in_body => {
                state.body_state.in_p = true;

                // 获取 p 标签的各个属性
                let start_ms = e
                    .try_get_attribute(ATTR_BEGIN)?
                    .map(|a| parse_ttml_time_to_ms(&attr_value_as_string(&a, reader)?))
                    .transpose()?
                    .unwrap_or(0);

                let end_ms = e
                    .try_get_attribute(ATTR_END)?
                    .map(|a| parse_ttml_time_to_ms(&attr_value_as_string(&a, reader)?))
                    .transpose()?
                    .unwrap_or(0);

                let agent = e
                    .try_get_attribute(ATTR_AGENT)?
                    .or(e.try_get_attribute(ATTR_AGENT_ALIAS)?)
                    .map(|a| attr_value_as_string(&a, reader))
                    .transpose()?;

                let song_part = e
                    .try_get_attribute(ATTR_ITUNES_SONG_PART)?
                    .map(|a| attr_value_as_string(&a, reader))
                    .transpose()?
                    .or(state.body_state.current_div_song_part.clone());

                let itunes_key = e
                    .try_get_attribute(ATTR_ITUNES_KEY)?
                    .map(|a| attr_value_as_string(&a, reader))
                    .transpose()?;

                // 创建 p 元素数据容器
                let p_data = CurrentPElementData {
                    start_ms,
                    end_ms,
                    agent,
                    song_part,
                    itunes_key,
                    ..Default::default()
                };

                state.body_state.current_p_element_data = Some(p_data);
                // 重置 p 内部的状态
                state.text_buffer.clear();
                state.body_state.span_stack.clear();
            }
            _ => {}
        },
        Event::End(e) => match e.local_name().as_ref() {
            TAG_DIV if state.body_state.in_div => {
                state.body_state.in_div = false;
                state.body_state.current_div_song_part = None; // 离开 div 时清除
            }
            TAG_METADATA => state.in_metadata_section = false,
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

/// 处理在 `<metadata>` 区域内的事件。
/// 这是一个分发器，将事件进一步传递给更具体的处理函数。
fn handle_metadata_event<'a>(
    event: &Event<'a>,
    state: &mut TtmlParserState,
    reader: &mut Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    match event {
        Event::Start(e) => handle_metadata_start_event(
            e,
            &mut state.metadata_state,
            &mut state.xml_ids,
            &mut state.text_buffer,
            reader,
            raw_metadata,
            warnings,
        )?,
        Event::Empty(e) => {
            // 处理自闭合标签如 <meta ... />
            handle_metadata_empty_event(e, &mut state.xml_ids, reader, raw_metadata, warnings)?
        }
        Event::Text(e) => {
            handle_metadata_text_event(e, &mut state.metadata_state, &mut state.text_buffer)?
        }
        Event::GeneralRef(e) => {
            let entity_name = str::from_utf8(e.as_ref()).map_err(|err| {
                ConvertError::Internal(format!("无法将实体名解码为UTF-8: {}", err))
            })?;

            let decoded_char = match entity_name {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" => '\'',
                _ => {
                    warnings.push(format!(
                        "TTML元数据警告: 忽略了未知的XML实体 '&{};'",
                        entity_name
                    ));
                    '\0'
                }
            };

            if decoded_char != '\0' {
                if state.metadata_state.in_songwriter_tag {
                    state
                        .metadata_state
                        .current_songwriter_name
                        .push(decoded_char);
                } else if state.metadata_state.in_agent_name_tag {
                    state
                        .metadata_state
                        .current_agent_name_text
                        .push(decoded_char);
                } else if state.metadata_state.in_ttm_metadata_tag {
                    state.text_buffer.push(decoded_char);
                }
            }
        }
        Event::End(e) => {
            if e.local_name().as_ref() == TAG_METADATA {
                state.in_metadata_section = false;
            } else {
                handle_metadata_end_event(
                    e,
                    &mut state.metadata_state,
                    &mut state.text_buffer,
                    raw_metadata,
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// 处理在 `<p>` 标签内部的事件。
fn handle_p_event<'a>(
    event: &Event<'a>,
    state: &mut TtmlParserState,
    reader: &Reader<&[u8]>,
    lines: &mut Vec<LyricLine>,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    match event {
        Event::Start(e) if e.local_name().as_ref() == TAG_SPAN => {
            process_span_start(e, state, reader)?;
        }
        Event::Text(e) => process_text_event(e, state)?,
        Event::GeneralRef(e) => {
            let entity_name = str::from_utf8(e.as_ref()).map_err(|err| {
                ConvertError::Internal(format!("无法将实体名解码为UTF-8: {}", err))
            })?;

            let decoded_char = match entity_name {
                "amp" => '&',
                "lt" => '<',
                "gt" => '>',
                "quot" => '"',
                "apos" => '\'',
                _ => {
                    warnings.push(format!(
                        "TTML解析警告: 忽略了未知的XML实体 '&{};'",
                        entity_name
                    ));
                    '\0'
                }
            };

            if decoded_char != '\0' {
                if let Some(p_data) = state.body_state.current_p_element_data.as_mut() {
                    if !state.body_state.span_stack.is_empty() {
                        state.text_buffer.push(decoded_char);
                    } else {
                        p_data.line_text_accumulator.push(decoded_char);
                    }
                }
            }
        }

        Event::End(e) => {
            match e.local_name().as_ref() {
                TAG_BR => {
                    warnings.push(format!(
                        "在 <p> ({}ms-{}ms) 中发现并忽略了一个 <br/> 标签。",
                        state
                            .body_state
                            .current_p_element_data
                            .as_ref()
                            .map_or(0, |d| d.start_ms),
                        state
                            .body_state
                            .current_p_element_data
                            .as_ref()
                            .map_or(0, |d| d.end_ms)
                    ));
                }
                TAG_P => {
                    // 当 </p> 出现时，意味着一行歌词的数据已经全部收集完毕。
                    // 调用 finalize_p_element 来处理和整合这些数据。
                    if let Some(mut p_data) = state.body_state.current_p_element_data.take() {
                        // 特殊处理：回填来自 <iTunesMetadata> 的翻译
                        if let Some(key) = &p_data.itunes_key
                            && let Some((text, lang)) =
                                state.metadata_state.translation_map.get(key)
                        {
                            // 避免重复添加
                            if p_data
                                .translations_accumulator
                                .iter()
                                .all(|t| &t.text != text)
                            {
                                p_data.translations_accumulator.push(TranslationEntry {
                                    text: text.clone(),
                                    lang: lang.clone(),
                                });
                            }
                        }
                        finalize_p_element(p_data, lines, state, warnings);
                    }
                    // 重置 p 内部的状态
                    state.body_state.in_p = false;
                    state.body_state.span_stack.clear();
                    state.body_state.last_syllable_info = LastSyllableInfo::None;
                }
                TAG_SPAN => {
                    process_span_end(state, warnings)?;
                }
                _ => {}
            }
        }
        _ => {}
    }
    Ok(())
}

// =================================================================================
// 5. XML 元素与事件处理器 (XML Element & Event Processors)
// =================================================================================

/// 用于处理 `<ttm:agent>` 的辅助函数。
fn process_agent_tag(
    e: &BytesStart,
    xml_ids: &mut HashSet<String>,
    reader: &Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    warnings: &mut Vec<String>,
) -> Result<Option<String>, ConvertError> {
    // 获取 xml:id 和 type 属性
    let agent_id = e
        .try_get_attribute(ATTR_XML_ID)?
        .map(|a| attr_value_as_string(&a, reader))
        .transpose()?;

    if let Some(id_val) = &agent_id {
        check_and_store_xml_id(id_val, xml_ids, warnings);

        let agent_type = e
            .try_get_attribute(ATTR_TYPE)?
            .map(|a| attr_value_as_string(&a, reader))
            .transpose()?
            .unwrap_or_else(|| "person".to_string());

        raw_metadata
            .entry(format!("agent-type-{id_val}"))
            .or_default()
            .push(agent_type);
    }

    Ok(agent_id)
}

fn handle_metadata_start_event<'a>(
    e: &BytesStart<'a>,
    state: &mut MetadataParseState,
    xml_ids: &mut HashSet<String>,
    text_buffer: &mut String,
    reader: &mut Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    let local_name_str = get_local_name_str(e.local_name())?;
    match e.local_name().as_ref() {
        TAG_META => process_meta_tag(e, reader, raw_metadata)?,
        TAG_ITUNES_METADATA => state.in_itunes_metadata = true,
        TAG_TRANSLATIONS if state.in_itunes_metadata => state.in_am_translations = true,
        TAG_TRANSLATION if state.in_am_translations => {
            state.in_am_translation = true;
            // 获取 xml:lang
            state.current_am_translation_lang = e
                .try_get_attribute(ATTR_XML_LANG)?
                .map(|attr| attr_value_as_string(&attr, reader))
                .transpose()?;
        }
        TAG_TEXT if state.in_am_translation => {
            // 获取 for 属性
            if let Some(attr) = e.try_get_attribute(ATTR_FOR)? {
                let key = attr_value_as_string(&attr, reader)?;
                let text_content = reader.read_text(e.name())?;
                if !text_content.is_empty() {
                    state.translation_map.insert(
                        key,
                        (
                            text_content.to_string(),
                            state.current_am_translation_lang.clone(),
                        ),
                    );
                }
            }
        }
        TAG_SONGWRITERS if state.in_itunes_metadata => state.in_songwriters_tag = true,
        TAG_SONGWRITER if state.in_songwriters_tag => {
            state.in_songwriter_tag = true;
            state.current_songwriter_name.clear();
        }
        TAG_AGENT if e.name().as_ref().starts_with(b"ttm:") => {
            if let Some(agent_id) = process_agent_tag(e, xml_ids, reader, raw_metadata, warnings)? {
                state.in_agent_tag = true;
                state.current_agent_id_for_name = Some(agent_id);
            }
        }
        TAG_NAME if state.in_agent_tag && e.name().as_ref().starts_with(b"ttm:") => {
            state.in_agent_name_tag = true;
            state.current_agent_name_text.clear();
        }
        _ if e.name().as_ref().starts_with(b"ttm:") => {
            // 通用 ttm:* 元数据处理
            state.in_ttm_metadata_tag = true;
            state.current_ttm_metadata_key = Some(local_name_str);
            text_buffer.clear();
        }
        _ => {}
    }
    Ok(())
}

fn handle_metadata_empty_event<'a>(
    e: &BytesStart<'a>,
    xml_ids: &mut HashSet<String>,
    reader: &Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    match e.local_name().as_ref() {
        TAG_META => process_meta_tag(e, reader, raw_metadata)?,
        TAG_AGENT if e.name().as_ref().starts_with(b"ttm:") => {
            process_agent_tag(e, xml_ids, reader, raw_metadata, warnings)?;
        }
        _ => {}
    }
    Ok(())
}

fn handle_metadata_text_event(
    e: &BytesText,
    state: &mut MetadataParseState,
    text_buffer: &mut String,
) -> Result<(), ConvertError> {
    let text_val = e.decode()?;
    if state.in_songwriter_tag {
        state.current_songwriter_name.push_str(&text_val);
    } else if state.in_agent_name_tag {
        state.current_agent_name_text.push_str(&text_val);
    } else if state.in_ttm_metadata_tag {
        text_buffer.push_str(&text_val);
    }
    Ok(())
}

fn handle_metadata_end_event(
    e: &BytesEnd,
    state: &mut MetadataParseState,
    text_buffer: &mut String,
    raw_metadata: &mut HashMap<String, Vec<String>>,
) -> Result<(), ConvertError> {
    let ended_tag_name = get_local_name_str(e.local_name())?;
    match ended_tag_name.as_bytes() {
        TAG_ITUNES_METADATA => state.in_itunes_metadata = false,
        TAG_TRANSLATIONS => state.in_am_translations = false,
        TAG_TRANSLATION => state.in_am_translation = false,
        TAG_SONGWRITER => {
            if !state.current_songwriter_name.is_empty() {
                raw_metadata
                    .entry("songwriters".to_string())
                    .or_default()
                    .push(state.current_songwriter_name.trim().to_string());
            }
            state.in_songwriter_tag = false;
        }
        TAG_SONGWRITERS => state.in_songwriters_tag = false,
        TAG_NAME if state.in_agent_name_tag && e.name().as_ref().starts_with(b"ttm:") => {
            if let Some(agent_id) = &state.current_agent_id_for_name {
                let agent_display_name = state.current_agent_name_text.trim().to_string();
                if !agent_display_name.is_empty() {
                    raw_metadata
                        .entry("agent".to_string())
                        .or_default()
                        .push(format!("{agent_id}={agent_display_name}"));
                }
            }
            state.in_agent_name_tag = false;
        }
        TAG_AGENT if state.in_agent_tag && e.name().as_ref().starts_with(b"ttm:") => {
            state.in_agent_tag = false;
            state.current_agent_id_for_name = None;
        }
        _ => {
            // 通用 ttm:* 元数据结束标签处理
            if state.in_ttm_metadata_tag
                && let Some(key) = state.current_ttm_metadata_key.as_ref()
                && *key == ended_tag_name
            {
                let value = normalize_text_whitespace(text_buffer);
                if !value.is_empty() {
                    raw_metadata.entry(key.clone()).or_default().push(value);
                }
                state.in_ttm_metadata_tag = false;
                state.current_ttm_metadata_key = None;
                text_buffer.clear();
            }
        }
    }
    Ok(())
}

/// 处理 `<tt>` 标签的开始事件，这是文档的根元素。
/// 主要任务是确定计时模式（逐行 vs 逐字）和文档的默认语言。
fn process_tt_start(
    e: &BytesStart,
    state: &mut TtmlParserState,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    reader: &Reader<&[u8]>,
    has_timed_span_tags: bool,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    // 获取 itunes:timing 属性
    let timing_attr = e.try_get_attribute(ATTR_ITUNES_TIMING)?;
    if let Some(attr) = timing_attr {
        if attr.value.as_ref() == b"line" {
            state.is_line_timing_mode = true;
        }
    } else if !has_timed_span_tags {
        // 如果没有找到 itunes:timing 属性，并且未发现任何带时间属性的 <span> 标签
        state.is_line_timing_mode = true;
        state.detected_line_mode = true;
        warnings.push(
            "未找到带时间戳的 <span> 标签且未指定 itunes:timing 模式，已自动切换到逐行歌词模式。"
                .to_string(),
        );
    }

    // 获取 xml:lang 属性
    if let Some(attr) = e.try_get_attribute(ATTR_XML_LANG)? {
        let lang_val = attr_value_as_string(&attr, reader)?;
        if !lang_val.is_empty() {
            raw_metadata
                .entry("xml:lang_root".to_string())
                .or_default()
                .push(lang_val.clone());
            if state.default_main_lang.is_none() {
                state.default_main_lang = Some(lang_val);
            }
        }
    }

    Ok(())
}

/// 处理 `<meta>` 标签，提取 key-value 形式的元数据。
fn process_meta_tag(
    e: &BytesStart,
    reader: &Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
) -> Result<(), ConvertError> {
    // 获取 key 和 value 属性
    let key_attr = e.try_get_attribute(ATTR_KEY)?;
    let value_attr = e.try_get_attribute(ATTR_VALUE)?;

    if let (Some(k_attr), Some(v_attr)) = (key_attr, value_attr) {
        let k = attr_value_as_string(&k_attr, reader)?;
        let v = attr_value_as_string(&v_attr, reader)?;
        if !k.is_empty() {
            raw_metadata.entry(k).or_default().push(v);
        }
    }

    Ok(())
}

/// 处理 `<span>` 标签的开始事件。
/// 这是解析器中最复杂的部分之一，需要确定 span 的角色、语言和时间信息。
fn process_span_start(
    e: &BytesStart,
    state: &mut TtmlParserState,
    reader: &Reader<&[u8]>,
) -> Result<(), ConvertError> {
    // 进入新的 span 前，清空文本缓冲区
    state.text_buffer.clear();

    // 获取 span 的各个属性
    let role = e
        .try_get_attribute(ATTR_ROLE)?
        .or(e.try_get_attribute(ATTR_ROLE_ALIAS)?)
        .map(|attr| match attr.value.as_ref() {
            ROLE_TRANSLATION => SpanRole::Translation,
            ROLE_ROMANIZATION => SpanRole::Romanization,
            ROLE_BACKGROUND => SpanRole::Background,
            _ => SpanRole::Generic,
        })
        .unwrap_or(SpanRole::Generic);

    let lang = e
        .try_get_attribute(ATTR_XML_LANG)?
        .map(|a| attr_value_as_string(&a, reader))
        .transpose()?;

    let scheme = e
        .try_get_attribute(ATTR_XML_SCHEME)?
        .map(|a| attr_value_as_string(&a, reader))
        .transpose()?;

    let start_ms = e
        .try_get_attribute(ATTR_BEGIN)?
        .map(|a| parse_ttml_time_to_ms(&attr_value_as_string(&a, reader)?))
        .transpose()?;

    let end_ms = e
        .try_get_attribute(ATTR_END)?
        .map(|a| parse_ttml_time_to_ms(&attr_value_as_string(&a, reader)?))
        .transpose()?;

    // 将解析出的上下文压入堆栈，以支持嵌套 span
    state.body_state.span_stack.push(SpanContext {
        role,
        lang,
        scheme,
        start_ms,
        end_ms,
    });

    // 如果是背景人声容器的开始，则初始化背景数据累加器
    if role == SpanRole::Background
        && let Some(p_data) = state.body_state.current_p_element_data.as_mut()
        && p_data.background_section_accumulator.is_none()
    {
        p_data.background_section_accumulator = Some(BackgroundSectionData {
            start_ms: start_ms.unwrap_or(0),
            end_ms: end_ms.unwrap_or(0),
            ..Default::default()
        });
    }
    Ok(())
}

/// 处理文本事件。
/// 这个函数的核心逻辑是区分 "音节间的空格" 和 "音节内的文本"。
fn process_text_event(e_text: &BytesText, state: &mut TtmlParserState) -> Result<(), ConvertError> {
    let text_slice = e_text.decode()?;

    if !state.body_state.in_p {
        return Ok(()); // 不在 <p> 标签内，忽略任何文本
    }

    // --- 处理音节间的空格 ---
    // 如果上一个事件是一个结束的音节 (</span>)，并且当前文本是纯空格，
    // 那么这个空格应该附加到上一个音节上，表示它后面有一个空格。
    if let LastSyllableInfo::EndedSyllable { was_background } = state.body_state.last_syllable_info
        && !text_slice.is_empty()
        && text_slice.chars().all(char::is_whitespace)
    {
        if let Some(p_data) = state.body_state.current_p_element_data.as_mut() {
            // 根据上一个音节是否是背景音，找到正确的音节列表
            let target_syllables = if was_background {
                p_data
                    .background_section_accumulator
                    .as_mut()
                    .map(|bs| &mut bs.syllables)
            } else {
                Some(&mut p_data.syllables_accumulator)
            };

            // 更新最后一个音节的 `ends_with_space` 标志
            if let Some(last_syl) = target_syllables.and_then(|s| s.last_mut())
                && !last_syl.ends_with_space
            {
                last_syl.ends_with_space = true;
            }
        }
        // 消费掉这个空格，并重置状态，然后直接返回
        state.body_state.last_syllable_info = LastSyllableInfo::None;
        return Ok(());
    }

    // --- 如果不是音节间空格，则处理常规文本 ---
    let trimmed_text = text_slice.trim();
    if trimmed_text.is_empty() {
        // 如果trim后为空（意味着它不是音节间空格，只是普通的空白节点），则忽略
        return Ok(());
    }

    // 任何非音节间空格的文本出现后，重置 `last_syllable_info`
    state.body_state.last_syllable_info = LastSyllableInfo::None;

    // 累加到缓冲区
    if !state.body_state.span_stack.is_empty() {
        // 如果在 span 内，文本属于这个 span
        state.text_buffer.push_str(&text_slice);
    } else if let Some(p_data) = state.body_state.current_p_element_data.as_mut() {
        // 如果在 p 内但在任何 span 外，文本直接属于 p
        p_data.line_text_accumulator.push_str(&text_slice);
    }

    Ok(())
}

/// 处理 `</span>` 结束事件的分发器。
fn process_span_end(
    state: &mut TtmlParserState,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    // 重置，因为 span 已经结束
    state.body_state.last_syllable_info = LastSyllableInfo::None;

    // 从堆栈中弹出刚刚结束的 span 的上下文
    if let Some(ended_span_ctx) = state.body_state.span_stack.pop() {
        // 获取并清空缓冲区中的文本
        let raw_text_from_buffer = state.text_buffer.clone();
        state.text_buffer.clear();

        // 根据 span 的角色分发给不同的处理器
        match ended_span_ctx.role {
            SpanRole::Generic => {
                handle_generic_span_end(state, &ended_span_ctx, &raw_text_from_buffer, warnings)?
            }
            SpanRole::Translation | SpanRole::Romanization => {
                handle_auxiliary_span_end(state, &ended_span_ctx, &raw_text_from_buffer)?
            }
            SpanRole::Background => {
                handle_background_span_end(state, &ended_span_ctx, &raw_text_from_buffer, warnings)?
            }
        }
    }
    Ok(())
}

/// 处理普通音节 `<span>` 结束的逻辑。
fn handle_generic_span_end(
    state: &mut TtmlParserState,
    ctx: &SpanContext,
    text: &str,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    // 在逐行模式下，所有 span 的文本都简单地累加到行文本中
    if state.is_line_timing_mode {
        if let Some(p_data) = state.body_state.current_p_element_data.as_mut() {
            p_data.line_text_accumulator.push_str(text);
        }
        return Ok(());
    }

    if let (Some(start_ms), Some(end_ms)) = (ctx.start_ms, ctx.end_ms) {
        // 如果 span 内有任何内容（包括纯空格），我们就处理它
        if !text.is_empty() {
            if start_ms > end_ms {
                warnings.push(format!("TTML解析警告: 音节 '{}' 的时间戳无效 (start_ms {} > end_ms {}), 但仍会创建音节。", text.escape_debug(), start_ms, end_ms));
            }

            let p_data = state
                .body_state
                .current_p_element_data
                .as_mut()
                .ok_or_else(|| {
                    ConvertError::Internal("在处理 span 时丢失了 p_data 上下文".to_string())
                })?;
            let was_within_bg = state
                .body_state
                .span_stack
                .iter()
                .any(|s| s.role == SpanRole::Background);
            let trimmed_text = text.trim();

            // 根据内容创建不同类型的音节
            let syllable = if !trimmed_text.is_empty() {
                // Case A: 这是一个包含可见字符的普通音节
                LyricSyllable {
                    text: if was_within_bg {
                        clean_parentheses_from_bg_text(trimmed_text)
                    } else {
                        normalize_text_whitespace(trimmed_text)
                    },
                    start_ms,
                    end_ms: end_ms.max(start_ms),
                    duration_ms: Some(end_ms.saturating_sub(start_ms)),
                    ends_with_space: text.ends_with(char::is_whitespace),
                }
            } else {
                // Case B: 这是一个只包含空格的音节
                LyricSyllable {
                    text: " ".to_string(), // 将其内容规范化为单个空格
                    start_ms,
                    end_ms: end_ms.max(start_ms),
                    duration_ms: Some(end_ms.saturating_sub(start_ms)),
                    ends_with_space: false, // 本身就是空格，无需再有尾随空格
                }
            };

            // 将创建好的音节添加到正确的列表中
            let target_syllables = if was_within_bg {
                p_data
                    .background_section_accumulator
                    .as_mut()
                    .map(|bs| &mut bs.syllables)
            } else {
                Some(&mut p_data.syllables_accumulator)
            };

            if let Some(syllables) = target_syllables {
                syllables.push(syllable);
                state.body_state.last_syllable_info = LastSyllableInfo::EndedSyllable {
                    was_background: was_within_bg,
                };
            }
        }
        // 如果 text.is_empty() (例如 <span ...></span>), 则自然忽略
    } else if !text.trim().is_empty() {
        // span 内有文本但没有时间信息，发出警告，逻辑不变
        warnings.push(format!(
            "TTML 逐字歌词下，span缺少时间信息，文本 '{}' 被忽略。",
            text.trim().escape_debug()
        ));
    }

    Ok(())
}

/// 处理翻译和罗马音 `<span>` 结束的逻辑。
fn handle_auxiliary_span_end(
    state: &mut TtmlParserState,
    ctx: &SpanContext,
    text: &str,
) -> Result<(), ConvertError> {
    let normalized_text = normalize_text_whitespace(text);
    if normalized_text.is_empty() {
        return Ok(());
    }

    let p_data = state
        .body_state
        .current_p_element_data
        .as_mut()
        .ok_or_else(|| {
            ConvertError::Internal("在处理辅助 span 时丢失了 p_data 上下文".to_string())
        })?;

    // 同样需要检查是否在背景音容器内
    let was_within_bg = state
        .body_state
        .span_stack
        .iter()
        .any(|s| s.role == SpanRole::Background);

    // 确定语言，优先使用 span 自身的 xml:lang，否则使用全局默认值
    let lang_to_use = ctx.lang.clone().or_else(|| match ctx.role {
        SpanRole::Translation => state.default_translation_lang.clone(),
        SpanRole::Romanization => state.default_romanization_lang.clone(),
        _ => None,
    });

    match ctx.role {
        SpanRole::Translation => {
            let entry = TranslationEntry {
                text: normalized_text,
                lang: lang_to_use,
            };
            // 添加到正确的累加器
            if was_within_bg {
                if let Some(bg_section) = p_data.background_section_accumulator.as_mut() {
                    bg_section.translations.push(entry);
                }
            } else {
                p_data.translations_accumulator.push(entry);
            }
        }
        SpanRole::Romanization => {
            let entry = RomanizationEntry {
                text: normalized_text,
                lang: lang_to_use,
                scheme: ctx.scheme.clone(),
            };
            if was_within_bg {
                if let Some(bg_section) = p_data.background_section_accumulator.as_mut() {
                    bg_section.romanizations.push(entry);
                }
            } else {
                p_data.romanizations_accumulator.push(entry);
            }
        }
        _ => {} // 不应该发生
    }
    Ok(())
}

/// 处理背景人声容器 `<span>` 结束的逻辑。
fn handle_background_span_end(
    state: &mut TtmlParserState,
    ctx: &SpanContext,
    text: &str, // 背景容器直接包含的文本
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    let p_data = state
        .body_state
        .current_p_element_data
        .as_mut()
        .ok_or_else(|| {
            ConvertError::Internal("在处理背景 span 时丢失了 p_data 上下文".to_string())
        })?;

    // 如果背景容器本身没有时间戳，但内部有带时间戳的音节，
    // 则根据内部音节的时间范围来推断容器的时间范围。
    if let Some(bg_acc) = p_data.background_section_accumulator.as_mut()
        && (ctx.start_ms.is_none() || ctx.end_ms.is_none())
        && !bg_acc.syllables.is_empty()
    {
        bg_acc.start_ms = bg_acc
            .syllables
            .iter()
            .map(|s| s.start_ms)
            .min()
            .unwrap_or(bg_acc.start_ms);
        bg_acc.end_ms = bg_acc
            .syllables
            .iter()
            .map(|s| s.end_ms)
            .max()
            .unwrap_or(bg_acc.end_ms);
    }

    // 处理不规范的情况：背景容器直接包含文本，而不是通过嵌套的 span。
    let trimmed_text = text.trim();
    if !trimmed_text.is_empty() {
        warn!(
            "TTML 解析警告: <span ttm:role='x-bg'> 直接包含文本 '{}'。",
            trimmed_text.escape_debug()
        );
        if let (Some(start_ms), Some(end_ms)) = (ctx.start_ms, ctx.end_ms) {
            if let Some(bg_acc) = p_data.background_section_accumulator.as_mut() {
                // 只有在背景容器内部没有其他音节时，才将此直接文本视为一个音节
                if bg_acc.syllables.is_empty() {
                    bg_acc.syllables.push(LyricSyllable {
                        text: normalize_text_whitespace(trimmed_text),
                        start_ms,
                        end_ms: end_ms.max(start_ms),
                        duration_ms: Some(end_ms.saturating_sub(start_ms)),
                        ends_with_space: !text.is_empty() && text.ends_with(char::is_whitespace),
                    });
                    state.body_state.last_syllable_info = LastSyllableInfo::EndedSyllable {
                        was_background: true,
                    };
                } else {
                    warnings.push(format!("TTML 解析警告: <span ttm:role='x-bg'> 直接包含文本 '{}'，但其内部已有音节，此直接文本被忽略。", trimmed_text.escape_debug()));
                }
            }
        } else {
            warnings.push(format!(
                "TTML 解析警告: <span ttm:role='x-bg'> 直接包含文本 '{}'，但缺少时间信息，忽略。",
                trimmed_text.escape_debug()
            ));
        }
    }
    Ok(())
}

// =================================================================================
// 6. 数据终结逻辑 (Data Finalization Logic)
// =================================================================================

/// 在 `</p>` 结束时，终结并处理一个 `LyricLine`。
/// 这个函数负责将 `CurrentPElementData` 中的所有累积数据，
/// 组合成一个完整的 `LyricLine` 对象，并添加到最终结果中。
fn finalize_p_element(
    p_data: CurrentPElementData,
    lines: &mut Vec<LyricLine>,
    state: &TtmlParserState,
    warnings: &mut Vec<String>,
) {
    let CurrentPElementData {
        start_ms,
        end_ms,
        agent,
        song_part,
        line_text_accumulator,
        syllables_accumulator,
        translations_accumulator,
        romanizations_accumulator,
        background_section_accumulator,
        itunes_key,
    } = p_data;

    // 创建一个初步的 LyricLine
    let mut final_line = LyricLine {
        start_ms,
        end_ms,
        itunes_key,
        agent: agent.or_else(|| Some("v1".to_string())), // 默认 agent 为 v1
        song_part,
        translations: translations_accumulator,
        romanizations: romanizations_accumulator,
        ..Default::default()
    };

    // 根据计时模式，调用不同的处理逻辑
    if state.is_line_timing_mode {
        finalize_p_for_line_mode(
            &mut final_line,
            &line_text_accumulator,
            &syllables_accumulator,
            warnings,
        );
    } else {
        finalize_p_for_word_mode(
            &mut final_line,
            syllables_accumulator,
            &line_text_accumulator,
            warnings,
        );
    }

    // 处理累积的背景人声部分
    if let Some(bg_data) = background_section_accumulator
        && (!bg_data.syllables.is_empty()
            || !bg_data.translations.is_empty()
            || !bg_data.romanizations.is_empty())
    {
        final_line.background_section = Some(BackgroundSection {
            start_ms: bg_data.start_ms,
            end_ms: bg_data.end_ms,
            syllables: bg_data.syllables,
            translations: bg_data.translations,
            romanizations: bg_data.romanizations,
        });
    }

    if let Some(last_syl) = final_line.main_syllables.last_mut() {
        last_syl.ends_with_space = false;
    }
    if let Some(bg_section) = final_line.background_section.as_mut()
        && let Some(last_bg_syl) = bg_section.syllables.last_mut()
    {
        last_bg_syl.ends_with_space = false;
    }

    // 如果行有文本但没有音节，创建一个代表整行的音节
    if final_line.main_syllables.is_empty()
        && let Some(line_text) = final_line.line_text.as_ref().filter(|s| !s.is_empty())
        && final_line.end_ms > final_line.start_ms
    {
        final_line.main_syllables.push(LyricSyllable {
            text: line_text.clone(),
            start_ms: final_line.start_ms,
            end_ms: final_line.end_ms,
            duration_ms: Some(final_line.end_ms.saturating_sub(final_line.start_ms)),
            ends_with_space: false,
        });
    }

    // 最后检查：如果一行歌词是完全空的（没有文本、音节、翻译、背景等），
    // 并且时间戳无效，则不添加到最终结果中。
    if final_line.main_syllables.is_empty()
        && final_line.line_text.as_deref().is_none_or(str::is_empty)
        && final_line.translations.is_empty()
        && final_line.romanizations.is_empty()
        && final_line.background_section.is_none()
        && final_line.end_ms <= final_line.start_ms
    {
        return;
    }

    lines.push(final_line);
}

/// 处理逐行模式下 `<p>` 元素结束的逻辑。
fn finalize_p_for_line_mode(
    final_line: &mut LyricLine,
    line_text_accumulator: &str,
    syllables_accumulator: &[LyricSyllable],
    warnings: &mut Vec<String>,
) {
    let mut line_text_content = line_text_accumulator.to_string();

    // 兼容性处理：如果 p 内没有直接文本，但有带文本的 span，
    // 则将这些 span 的文本拼接起来作为行文本。
    if line_text_content.trim().is_empty() && !syllables_accumulator.is_empty() {
        line_text_content = syllables_accumulator
            .iter()
            .map(|s| {
                if s.ends_with_space {
                    format!("{} ", s.text)
                } else {
                    s.text.clone()
                }
            })
            .collect::<String>();
        warnings.push(format!(
            "TTML解析警告: 逐行段落 ({}ms-{}ms) 的文本来自其内部的逐字结构。",
            final_line.start_ms, final_line.end_ms
        ));
    }

    final_line.line_text = Some(normalize_text_whitespace(&line_text_content));

    // 在逐行模式下，音节的时间戳被忽略，记录一个警告。
    if !syllables_accumulator.is_empty() {
        warnings.push(format!(
            "TTML解析警告: 在逐行歌词的段落 ({}ms-{}ms) 中检测到并忽略了 {} 个逐字音节的时间戳。",
            final_line.start_ms,
            final_line.end_ms,
            syllables_accumulator.len()
        ));
    }
}

/// 处理逐字模式下 `<p>` 元素结束的逻辑。
fn finalize_p_for_word_mode(
    final_line: &mut LyricLine,
    syllables_accumulator: Vec<LyricSyllable>,
    line_text_accumulator: &str,
    warnings: &mut Vec<String>,
) {
    final_line.main_syllables = syllables_accumulator;

    // 处理那些在 `<p>` 标签内但没有被 `<span>` 包裹的文本。
    let unhandled_p_text = normalize_text_whitespace(line_text_accumulator);
    if !unhandled_p_text.is_empty() {
        if final_line.main_syllables.is_empty() {
            // 如果行内没有任何音节，则将这些文本视为一个覆盖整行时间的音节。
            let syl_start = final_line.start_ms;
            let syl_end = final_line.end_ms;
            if syl_start > syl_end {
                warnings.push(format!("TTML解析警告: 为 <p> 标签内的直接文本 '{}' 创建音节时，时间戳无效 (start_ms {} > end_ms {}).", unhandled_p_text.escape_debug(), syl_start, syl_end));
            }
            final_line.main_syllables.push(LyricSyllable {
                text: unhandled_p_text.clone(),
                start_ms: syl_start,
                end_ms: syl_end.max(syl_start),
                duration_ms: Some(syl_end.saturating_sub(syl_start)),
                ends_with_space: false,
            });
        } else {
            // 如果行内已有音节，这些未被包裹的文本通常是无意义的，记录警告并忽略。
            warnings.push(format!(
                "TTML 逐字模式警告: 段落 ({}ms-{}ms) 包含未被span包裹的文本: '{}'。此文本被忽略。",
                final_line.start_ms,
                final_line.end_ms,
                unhandled_p_text.escape_debug()
            ));
        }
    }

    // 根据音节列表，重新组装整行的文本 `line_text`。
    if final_line.line_text.is_none() && !final_line.main_syllables.is_empty() {
        let assembled_line_text = final_line
            .main_syllables
            .iter()
            .map(|s| {
                if s.ends_with_space {
                    format!("{} ", s.text)
                } else {
                    s.text.clone()
                }
            })
            .collect::<String>();
        final_line.line_text = Some(assembled_line_text.trim_end().to_string());
    }
}

// =================================================================================
// 7. 工具函数 (Utility Functions)
// =================================================================================

/// 解析TTML时间字符串（支持多种格式）到毫秒。
fn parse_ttml_time_to_ms(time_str: &str) -> Result<u64, ConvertError> {
    // 格式 1: "12.345s"
    if let Some(stripped) = time_str.strip_suffix('s') {
        if stripped.is_empty() || stripped.starts_with('.') || stripped.ends_with('.') {
            return Err(ConvertError::InvalidTime(format!(
                "时间戳 '{time_str}' 包含无效的秒格式"
            )));
        }
        let seconds = stripped.parse::<f64>().map_err(|e| {
            ConvertError::InvalidTime(format!(
                "无法将秒值 '{stripped}' 从时间戳 '{time_str}' 解析为数字: {e}"
            ))
        })?;
        if seconds.is_sign_negative() {
            return Err(ConvertError::InvalidTime(format!(
                "时间戳不能为负: '{time_str}'"
            )));
        }
        let total_ms = seconds * 1000.0;
        if total_ms > u64::MAX as f64 {
            return Err(ConvertError::InvalidTime(format!(
                "时间戳 '{time_str}' 超出可表示范围"
            )));
        }
        return Ok(total_ms.round() as u64);
    }

    // 格式 2: "HH:MM:SS.mmm", "MM:SS.mmm", "SS.mmm"
    let colon_parts: Vec<&str> = time_str.split(':').collect();
    let hours: u64;
    let minutes: u64;
    let seconds: u64;
    let milliseconds: u64;

    // 辅助函数，用于解析毫秒部分（支持.1, .12, .123）
    let parse_ms_part = |ms_str: &str, original_time_str: &str| -> Result<u64, ConvertError> {
        if ms_str.is_empty() || ms_str.len() > 3 || ms_str.chars().any(|c| !c.is_ascii_digit()) {
            return Err(ConvertError::InvalidTime(format!(
                "毫秒部分 '{ms_str}' 在时间戳 '{original_time_str}' 中无效"
            )));
        }
        let val = ms_str.parse::<u64>().map_err(|e| {
            ConvertError::InvalidTime(format!(
                "无法解析时间戳 '{original_time_str}' 中的毫秒部分 '{ms_str}': {e}"
            ))
        })?;
        // 根据毫秒部分的长度补零 (e.g., "1" -> 100ms, "12" -> 120ms, "123" -> 123ms)
        Ok(val * 10u64.pow(3 - ms_str.len() as u32))
    };

    match colon_parts.len() {
        3 => {
            // HH:MM:SS.mmm
            hours = colon_parts[0].parse().map_err(|e| {
                ConvertError::InvalidTime(format!(
                    "在 '{}' 中解析小时 '{}' 失败: {}",
                    time_str, colon_parts[0], e
                ))
            })?;
            minutes = colon_parts[1].parse().map_err(|e| {
                ConvertError::InvalidTime(format!(
                    "在 '{}' 中解析分钟 '{}' 失败: {}",
                    time_str, colon_parts[1], e
                ))
            })?;
            let dot_parts: Vec<&str> = colon_parts[2].split('.').collect();
            if dot_parts[0].is_empty() {
                return Err(ConvertError::InvalidTime(format!(
                    "时间格式 '{time_str}' 无效。"
                )));
            }
            seconds = dot_parts[0].parse().map_err(|e| {
                ConvertError::InvalidTime(format!(
                    "在 '{}' 中解析秒 '{}' 失败: {}",
                    time_str, dot_parts[0], e
                ))
            })?;
            milliseconds = if dot_parts.len() == 2 {
                parse_ms_part(dot_parts[1], time_str)?
            } else if dot_parts.len() == 1 {
                0
            } else {
                return Err(ConvertError::InvalidTime(format!(
                    "时间格式 '{time_str}' 无效。"
                )));
            };
        }
        2 => {
            // MM:SS.mmm
            hours = 0;
            minutes = colon_parts[0].parse().map_err(|e| {
                ConvertError::InvalidTime(format!(
                    "在 '{}' 中解析分钟 '{}' 失败: {}",
                    time_str, colon_parts[0], e
                ))
            })?;
            let dot_parts: Vec<&str> = colon_parts[1].split('.').collect();
            if dot_parts[0].is_empty() {
                return Err(ConvertError::InvalidTime(format!(
                    "时间格式 '{time_str}' 无效。"
                )));
            }
            seconds = dot_parts[0].parse().map_err(|e| {
                ConvertError::InvalidTime(format!(
                    "在 '{}' 中解析秒 '{}' 失败: {}",
                    time_str, dot_parts[0], e
                ))
            })?;
            milliseconds = if dot_parts.len() == 2 {
                parse_ms_part(dot_parts[1], time_str)?
            } else if dot_parts.len() == 1 {
                0
            } else {
                return Err(ConvertError::InvalidTime(format!(
                    "时间格式 '{time_str}' 无效。"
                )));
            };
        }
        1 => {
            // SS.mmm 或 SS
            hours = 0;
            minutes = 0;
            let dot_parts: Vec<&str> = colon_parts[0].split('.').collect();
            if dot_parts[0].is_empty() {
                return Err(ConvertError::InvalidTime(format!(
                    "时间格式 '{time_str}' 无效。"
                )));
            }
            seconds = dot_parts[0].parse().map_err(|e| {
                ConvertError::InvalidTime(format!(
                    "在 '{}' 中解析秒 '{}' 失败: {}",
                    time_str, dot_parts[0], e
                ))
            })?;
            milliseconds = if dot_parts.len() == 2 {
                parse_ms_part(dot_parts[1], time_str)?
            } else if dot_parts.len() == 1 {
                0
            } else {
                return Err(ConvertError::InvalidTime(format!(
                    "时间格式 '{time_str}' 无效。"
                )));
            };
        }
        _ => {
            return Err(ConvertError::InvalidTime(format!(
                "时间格式 '{time_str}' 无效。"
            )));
        }
    }

    // --- 值范围检查 ---
    if minutes >= 60 {
        return Err(ConvertError::InvalidTime(format!(
            "分钟值 '{minutes}' (应 < 60) 在时间戳 '{time_str}' 中无效"
        )));
    }
    if (colon_parts.len() > 1) && seconds >= 60 {
        return Err(ConvertError::InvalidTime(format!(
            "秒值 '{seconds}' (应 < 60) 在时间戳 '{time_str}' 中无效"
        )));
    }

    Ok(hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + milliseconds)
}

/// 规范化文本中的空白字符
pub fn normalize_text_whitespace(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.split_whitespace().collect::<Vec<&str>>().join(" ")
}

/// 清理文本两端的括号（单个或成对）
fn clean_parentheses_from_bg_text(text: &str) -> String {
    text.trim()
        .trim_start_matches(['(', '（'])
        .trim_end_matches([')', '）'])
        .trim()
        .to_string()
}

/// 从 XML 事件的字节切片中获取本地标签名字符串。
fn get_local_name_str(name_bytes: impl AsRef<[u8]>) -> Result<String, ConvertError> {
    str::from_utf8(name_bytes.as_ref())
        .map(|s| s.to_string())
        .map_err(|err| ConvertError::Internal(format!("无法将标签名转换为UTF-8: {err}")))
}

/// 将 XML 属性值（可能包含实体引用如 &amp;）解码为字符串。
fn attr_value_as_string(attr: &Attribute, reader: &Reader<&[u8]>) -> Result<String, ConvertError> {
    Ok(attr
        .decode_and_unescape_value(reader.decoder())?
        .into_owned())
}

/// 检查 xml:id 的唯一性，如果重复则记录一个警告。
fn check_and_store_xml_id(id_str: &str, xml_ids: &mut HashSet<String>, warnings: &mut Vec<String>) {
    if !id_str.is_empty() && !xml_ids.insert(id_str.to_string()) {
        warnings.push(format!(
            "TTML解析警告: 检测到重复的 xml:id '{id_str}'。根据规范，该值应为唯一。"
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ttml_processor::types::ConvertError;

    #[test]
    fn test_parse_ttml_time_to_ms() {
        assert_eq!(parse_ttml_time_to_ms("01:02:03.456").unwrap(), 3723456);
        assert_eq!(parse_ttml_time_to_ms("05:10.1").unwrap(), 310100);
        assert_eq!(parse_ttml_time_to_ms("05:10.12").unwrap(), 310120);
        assert_eq!(parse_ttml_time_to_ms("7.123").unwrap(), 7123);
        assert_eq!(parse_ttml_time_to_ms("7").unwrap(), 7000);
        assert_eq!(parse_ttml_time_to_ms("15.5s").unwrap(), 15500);
        assert_eq!(parse_ttml_time_to_ms("15s").unwrap(), 15000);

        assert_eq!(parse_ttml_time_to_ms("0").unwrap(), 0);
        assert_eq!(parse_ttml_time_to_ms("0.0s").unwrap(), 0);
        assert_eq!(parse_ttml_time_to_ms("00:00:00.000").unwrap(), 0);

        assert!(matches!(
            parse_ttml_time_to_ms("abc"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("1:2:3:4"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("01:60:00.000"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("01:00:60.000"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("-10s"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("10.s"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms(".5s"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("s"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("10.1234"),
            Err(ConvertError::InvalidTime(_))
        ));
        assert!(matches!(
            parse_ttml_time_to_ms("10.abc"),
            Err(ConvertError::InvalidTime(_))
        ));
    }

    #[test]
    fn test_normalize_text_whitespace() {
        assert_eq!(
            normalize_text_whitespace("  hello   world  "),
            "hello world"
        );
        assert_eq!(normalize_text_whitespace("\n\t  foo \r\n bar\t"), "foo bar");
        assert_eq!(normalize_text_whitespace("single"), "single");
        assert_eq!(normalize_text_whitespace("   "), "");
        assert_eq!(normalize_text_whitespace(""), "");
    }

    #[test]
    fn test_clean_parentheses_from_bg_text() {
        assert_eq!(clean_parentheses_from_bg_text("(hello)"), "hello");
        assert_eq!(clean_parentheses_from_bg_text("（hello）"), "hello");
        assert_eq!(
            clean_parentheses_from_bg_text(" ( hello world ) "),
            "hello world"
        );
        assert_eq!(clean_parentheses_from_bg_text("(unmatched"), "unmatched");
        assert_eq!(clean_parentheses_from_bg_text("unmatched)"), "unmatched");
        assert_eq!(
            clean_parentheses_from_bg_text("no parentheses"),
            "no parentheses"
        );
    }
}
