use std::{
    collections::{HashMap, HashSet},
    str,
    sync::OnceLock,
};

use quick_xml::{
    Reader,
    events::{BytesEnd, BytesStart, BytesText, Event, attributes::Attribute},
};
use regex::Regex;
use tracing::{error, warn};

use crate::ttml_processor::types::{
    BackgroundSection, ConvertError, DefaultLanguageOptions, LyricFormat, LyricLine, LyricSyllable,
    ParsedSourceData, RomanizationEntry, TranslationEntry,
};

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
const ROLE_TRANSLATION: &[u8] = b"x-translation";
const ROLE_ROMANIZATION: &[u8] = b"x-roman";
const ROLE_BACKGROUND: &[u8] = b"x-bg";
#[derive(Debug, Default)]
struct TtmlParserState {
    is_line_timing_mode: bool,
    detected_line_mode: bool,
    default_main_lang: Option<String>,
    default_translation_lang: Option<String>,
    default_romanization_lang: Option<String>,
    xml_ids: HashSet<String>,
    text_buffer: String,
    in_metadata_section: bool,
    metadata_state: MetadataParseState,
    body_state: BodyParseState,
}

#[derive(Debug, Default)]
struct MetadataParseState {
    in_itunes_metadata: bool,
    in_am_translations: bool,
    in_am_translation: bool,
    current_am_translation_lang: Option<String>,
    translation_map: HashMap<String, (String, Option<String>)>,
    in_songwriters_tag: bool,
    in_songwriter_tag: bool,
    current_songwriter_name: String,
    in_agent_tag: bool,
    in_agent_name_tag: bool,
    current_agent_id_for_name: Option<String>,
    current_agent_name_text: String,
    in_ttm_metadata_tag: bool,
    current_ttm_metadata_key: Option<String>,
}

#[derive(Debug, Default)]
struct BodyParseState {
    in_body: bool,
    in_div: bool,
    in_p: bool,
    current_div_song_part: Option<String>,
    current_p_element_data: Option<CurrentPElementData>,
    span_stack: Vec<SpanContext>,
    last_syllable_info: LastSyllableInfo,
}

#[derive(Debug, Default, Clone)]
struct CurrentPElementData {
    start_ms: u64,
    end_ms: u64,
    agent: Option<String>,
    song_part: Option<String>,
    itunes_key: Option<String>,
    line_text_accumulator: String,
    syllables_accumulator: Vec<LyricSyllable>,
    translations_accumulator: Vec<TranslationEntry>,
    romanizations_accumulator: Vec<RomanizationEntry>,
    background_section_accumulator: Option<BackgroundSectionData>,
}

#[derive(Debug, Default, Clone)]
struct BackgroundSectionData {
    start_ms: u64,
    end_ms: u64,
    syllables: Vec<LyricSyllable>,
    translations: Vec<TranslationEntry>,
    romanizations: Vec<RomanizationEntry>,
}

#[derive(Debug, Clone)]
struct SpanContext {
    role: SpanRole,
    lang: Option<String>,
    scheme: Option<String>,
    start_ms: Option<u64>,
    end_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpanRole {
    Generic,
    Translation,
    Romanization,
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum LastSyllableInfo {
    #[default]
    None,
    EndedSyllable {
        was_background: bool,
    },
}

pub fn parse_ttml(
    content: &str,
    default_languages: &DefaultLanguageOptions,
) -> Result<ParsedSourceData, ConvertError> {
    static TIMED_SPAN_RE: OnceLock<Regex> = OnceLock::new();
    let timed_span_re =
        TIMED_SPAN_RE.get_or_init(|| Regex::new(r#"<span\s+[^>]*begin\s*="#).unwrap());
    let has_timed_span_tags = timed_span_re.is_match(content);

    let mut reader = Reader::from_str(content);
    let config = reader.config_mut();
    config.trim_text(false);
    config.expand_empty_elements = true;

    let mut lines: Vec<LyricLine> = Vec::new();
    let mut raw_metadata: HashMap<String, Vec<String>> = HashMap::new();
    let mut warnings: Vec<String> = Vec::new();

    let mut state = TtmlParserState {
        default_main_lang: default_languages.main.clone(),
        default_translation_lang: default_languages.translation.clone(),
        default_romanization_lang: default_languages.romanization.clone(),
        ..Default::default()
    };
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(event) => {
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
                error!("TTML 解析错误，位置 {}: {}", reader.buffer_position(), e);
                return Err(ConvertError::Xml(e));
            }
        }
        buf.clear();
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
                state.body_state.current_div_song_part = e
                    .try_get_attribute(ATTR_ITUNES_SONG_PART)?
                    .map(|attr| attr_value_as_string(&attr, reader))
                    .transpose()?;
            }
            TAG_P if state.body_state.in_body => {
                state.body_state.in_p = true;

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

                let p_data = CurrentPElementData {
                    start_ms,
                    end_ms,
                    agent,
                    song_part,
                    itunes_key,
                    ..Default::default()
                };

                state.body_state.current_p_element_data = Some(p_data);
                state.text_buffer.clear();
                state.body_state.span_stack.clear();
            }
            _ => {}
        },
        Event::End(e) => match e.local_name().as_ref() {
            TAG_DIV if state.body_state.in_div => {
                state.body_state.in_div = false;
                state.body_state.current_div_song_part = None;
            }
            TAG_METADATA => state.in_metadata_section = false,
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

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

        Event::End(e) => match e.local_name().as_ref() {
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
                if let Some(mut p_data) = state.body_state.current_p_element_data.take() {
                    if let Some(key) = &p_data.itunes_key
                        && let Some((text, lang)) = state.metadata_state.translation_map.get(key)
                    {
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
                state.body_state.in_p = false;
                state.body_state.span_stack.clear();
                state.body_state.last_syllable_info = LastSyllableInfo::None;
            }
            TAG_SPAN => {
                process_span_end(state, warnings)?;
            }
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

fn process_agent_tag(
    e: &BytesStart,
    xml_ids: &mut HashSet<String>,
    reader: &Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    warnings: &mut Vec<String>,
) -> Result<Option<String>, ConvertError> {
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
            state.current_am_translation_lang = e
                .try_get_attribute(ATTR_XML_LANG)?
                .map(|attr| attr_value_as_string(&attr, reader))
                .transpose()?;
        }
        TAG_TEXT if state.in_am_translation => {
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

fn process_tt_start(
    e: &BytesStart,
    state: &mut TtmlParserState,
    raw_metadata: &mut HashMap<String, Vec<String>>,
    reader: &Reader<&[u8]>,
    has_timed_span_tags: bool,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    let timing_attr = e.try_get_attribute(ATTR_ITUNES_TIMING)?;
    if let Some(attr) = timing_attr {
        if attr.value.as_ref() == b"line" {
            state.is_line_timing_mode = true;
        }
    } else if !has_timed_span_tags {
        state.is_line_timing_mode = true;
        state.detected_line_mode = true;
        warnings.push(
            "未找到带时间戳的 <span> 标签且未指定 itunes:timing 模式，已自动切换到逐行歌词模式。"
                .to_string(),
        );
    }

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

fn process_meta_tag(
    e: &BytesStart,
    reader: &Reader<&[u8]>,
    raw_metadata: &mut HashMap<String, Vec<String>>,
) -> Result<(), ConvertError> {
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

fn process_span_start(
    e: &BytesStart,
    state: &mut TtmlParserState,
    reader: &Reader<&[u8]>,
) -> Result<(), ConvertError> {
    state.text_buffer.clear();

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

    state.body_state.span_stack.push(SpanContext {
        role,
        lang,
        scheme,
        start_ms,
        end_ms,
    });
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

fn process_text_event(e_text: &BytesText, state: &mut TtmlParserState) -> Result<(), ConvertError> {
    let text_slice = e_text.decode()?;

    if !state.body_state.in_p {
        return Ok(());
    }

    if let LastSyllableInfo::EndedSyllable { was_background } = state.body_state.last_syllable_info
        && !text_slice.is_empty()
        && text_slice.chars().all(char::is_whitespace)
    {
        if let Some(p_data) = state.body_state.current_p_element_data.as_mut() {
            let target_syllables = if was_background {
                p_data
                    .background_section_accumulator
                    .as_mut()
                    .map(|bs| &mut bs.syllables)
            } else {
                Some(&mut p_data.syllables_accumulator)
            };

            if let Some(last_syl) = target_syllables.and_then(|s| s.last_mut())
                && !last_syl.ends_with_space
            {
                last_syl.ends_with_space = true;
            }
        }
        state.body_state.last_syllable_info = LastSyllableInfo::None;
        return Ok(());
    }

    let trimmed_text = text_slice.trim();
    if trimmed_text.is_empty() {
        return Ok(());
    }

    state.body_state.last_syllable_info = LastSyllableInfo::None;

    if !state.body_state.span_stack.is_empty() {
        state.text_buffer.push_str(&text_slice);
    } else if let Some(p_data) = state.body_state.current_p_element_data.as_mut() {
        p_data.line_text_accumulator.push_str(&text_slice);
    }

    Ok(())
}

fn process_span_end(
    state: &mut TtmlParserState,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    state.body_state.last_syllable_info = LastSyllableInfo::None;

    if let Some(ended_span_ctx) = state.body_state.span_stack.pop() {
        let raw_text_from_buffer = state.text_buffer.clone();
        state.text_buffer.clear();

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

fn handle_generic_span_end(
    state: &mut TtmlParserState,
    ctx: &SpanContext,
    text: &str,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    if state.is_line_timing_mode {
        if let Some(p_data) = state.body_state.current_p_element_data.as_mut() {
            p_data.line_text_accumulator.push_str(text);
        }
        return Ok(());
    }

    if let (Some(start_ms), Some(end_ms)) = (ctx.start_ms, ctx.end_ms) {
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

            let syllable = if !trimmed_text.is_empty() {
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
                LyricSyllable {
                    text: " ".to_string(),
                    start_ms,
                    end_ms: end_ms.max(start_ms),
                    duration_ms: Some(end_ms.saturating_sub(start_ms)),
                    ends_with_space: false,
                }
            };

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
    } else if !text.trim().is_empty() {
        warnings.push(format!(
            "TTML 逐字歌词下，span缺少时间信息，文本 '{}' 被忽略。",
            text.trim().escape_debug()
        ));
    }

    Ok(())
}

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

    let was_within_bg = state
        .body_state
        .span_stack
        .iter()
        .any(|s| s.role == SpanRole::Background);

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
        _ => {}
    }
    Ok(())
}

fn handle_background_span_end(
    state: &mut TtmlParserState,
    ctx: &SpanContext,
    text: &str,
    warnings: &mut Vec<String>,
) -> Result<(), ConvertError> {
    let p_data = state
        .body_state
        .current_p_element_data
        .as_mut()
        .ok_or_else(|| {
            ConvertError::Internal("在处理背景 span 时丢失了 p_data 上下文".to_string())
        })?;

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

    let trimmed_text = text.trim();
    if !trimmed_text.is_empty() {
        warn!(
            "TTML 解析警告: <span ttm:role='x-bg'> 直接包含文本 '{}'。",
            trimmed_text.escape_debug()
        );
        if let (Some(start_ms), Some(end_ms)) = (ctx.start_ms, ctx.end_ms) {
            if let Some(bg_acc) = p_data.background_section_accumulator.as_mut() {
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

    let mut final_line = LyricLine {
        start_ms,
        end_ms,
        itunes_key,
        agent: agent.or_else(|| Some("v1".to_string())),
        song_part,
        translations: translations_accumulator,
        romanizations: romanizations_accumulator,
        ..Default::default()
    };

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

fn finalize_p_for_line_mode(
    final_line: &mut LyricLine,
    line_text_accumulator: &str,
    syllables_accumulator: &[LyricSyllable],
    warnings: &mut Vec<String>,
) {
    let mut line_text_content = line_text_accumulator.to_string();

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

    if !syllables_accumulator.is_empty() {
        warnings.push(format!(
            "TTML解析警告: 在逐行歌词的段落 ({}ms-{}ms) 中检测到并忽略了 {} 个逐字音节的时间戳。",
            final_line.start_ms,
            final_line.end_ms,
            syllables_accumulator.len()
        ));
    }
}

fn finalize_p_for_word_mode(
    final_line: &mut LyricLine,
    syllables_accumulator: Vec<LyricSyllable>,
    line_text_accumulator: &str,
    warnings: &mut Vec<String>,
) {
    final_line.main_syllables = syllables_accumulator;

    let unhandled_p_text = normalize_text_whitespace(line_text_accumulator);
    if !unhandled_p_text.is_empty() {
        if final_line.main_syllables.is_empty() {
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
            warnings.push(format!(
                "TTML 逐字模式警告: 段落 ({}ms-{}ms) 包含未被span包裹的文本: '{}'。此文本被忽略。",
                final_line.start_ms,
                final_line.end_ms,
                unhandled_p_text.escape_debug()
            ));
        }
    }

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

fn parse_ttml_time_to_ms(time_str: &str) -> Result<u64, ConvertError> {
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

    let colon_parts: Vec<&str> = time_str.split(':').collect();
    let hours: u64;
    let minutes: u64;
    let seconds: u64;
    let milliseconds: u64;

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
        Ok(val * 10u64.pow(3 - ms_str.len() as u32))
    };

    match colon_parts.len() {
        3 => {
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

pub fn normalize_text_whitespace(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.split_whitespace().collect::<Vec<&str>>().join(" ")
}

fn clean_parentheses_from_bg_text(text: &str) -> String {
    text.trim()
        .trim_start_matches(['(', '（'])
        .trim_end_matches([')', '）'])
        .trim()
        .to_string()
}

fn get_local_name_str(name_bytes: impl AsRef<[u8]>) -> Result<String, ConvertError> {
    str::from_utf8(name_bytes.as_ref())
        .map(|s| s.to_string())
        .map_err(|err| ConvertError::Internal(format!("无法将标签名转换为UTF-8: {err}")))
}

fn attr_value_as_string(attr: &Attribute, reader: &Reader<&[u8]>) -> Result<String, ConvertError> {
    Ok(attr
        .decode_and_unescape_value(reader.decoder())?
        .into_owned())
}

fn check_and_store_xml_id(id_str: &str, xml_ids: &mut HashSet<String>, warnings: &mut Vec<String>) {
    if !id_str.is_empty() && !xml_ids.insert(id_str.to_string()) {
        warnings.push(format!(
            "TTML解析警告: 检测到重复的 xml:id '{id_str}'。根据规范，该值应为唯一。"
        ));
    }
}
