use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    io::{self, BufRead, BufReader, Read},
};

// Safety bounds, independent of HTTP Content-Length. No partial snapshot is saved.
// Retained-data accounting includes conservative allowances for container capacity
// and member identity indexes; it is a payload budget, not a process RSS guarantee.
pub const MAX_DOCUMENT_BYTES: usize = 256 * 1024 * 1024;
const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_RETAINED_BYTES: usize = 384 * 1024 * 1024;
const MAX_NODES: usize = 8_000_000;

// Bound quick-xml before it can grow its event buffer for an unterminated token.
struct EventInput<R> {
    inner: BufReader<R>,
    event_bytes: usize,
    total_bytes: usize,
}
impl<R: Read> Read for EventInput<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let available = self.fill_buf()?;
        let n = available.len().min(out.len());
        out[..n].copy_from_slice(&available[..n]);
        self.consume(n);
        Ok(n)
    }
}
impl<R: Read> BufRead for EventInput<R> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        let available = self.inner.fill_buf()?;
        if available.is_empty() {
            return Ok(available);
        }
        if self.total_bytes >= MAX_DOCUMENT_BYTES {
            return Err(io::Error::other("XML exceeds 256 MiB document limit"));
        }
        if self.event_bytes >= MAX_EVENT_BYTES {
            return Err(io::Error::other("XML token exceeds 1 MiB limit"));
        }
        let n = available.len().min(MAX_EVENT_BYTES - self.event_bytes)
            .min(MAX_DOCUMENT_BYTES - self.total_bytes);
        Ok(&available[..n])
    }
    fn consume(&mut self, n: usize) {
        self.inner.consume(n);
        self.event_bytes += n;
        self.total_bytes += n;
    }
}
fn charge(retained: &mut usize, bytes: usize) -> Result<(), String> {
    *retained = retained.saturating_add(bytes);
    if *retained > MAX_RETAINED_BYTES {
        return Err("XML exceeds 384 MiB accounted payload budget".into());
    }
    Ok(())
}

pub fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Node {
    pub name: String,
    pub attrs: BTreeMap<String, String>,
    pub text: String,
    pub children: Vec<Node>,
}
impl Node {
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|n| n.name == name)
    }
    pub fn value(&self, name: &str) -> Option<&str> {
        self.attrs
            .get(name)
            .map(String::as_str)
            .or_else(|| self.child(name).map(|n| n.text.as_str()))
    }
    pub fn field(&self, group: &str, key: &str) -> Option<&str> {
        self.child(group)?.value(key)
    }
}
#[derive(Clone)]
pub struct Member {
    pub key: String,
    pub parent: String,
    pub session: usize,
    pub ordinal: usize,
    pub ambiguous: bool,
    pub parent_ambiguous: bool,
    pub raw: Node,
}
pub struct Parsed {
    pub metadata: Node,
    pub members: Vec<Member>,
    pub sessions: usize,
    pub reported_sessions: i64,
    pub reported_connections: i64,
    pub clients: usize,
    pub device_time: Option<String>,
    pub warnings: Vec<String>,
}
pub fn finite(value: Option<&str>) -> Option<f64> {
    value?.parse::<f64>().ok().filter(|n| n.is_finite())
}
fn required_count(n: &Node, name: &str) -> Result<i64, String> {
    n.value(name)
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|v| *v >= 0)
        .ok_or_else(|| format!("Missing or invalid Total.{name}"))
}
/// Incremental UTF-8 event reader with bounded input, token and retained-data budgets.
/// The bounded tree holds the payload required by SQLite, never the original XML.
pub fn parse(xml: &str) -> Result<Parsed, String> {
    parse_reader(xml.as_bytes())
}
pub fn parse_reader(input: impl Read) -> Result<Parsed, String> {
    parse_reader_controlled(input, || false)
}
pub fn parse_reader_controlled(
    input: impl Read,
    cancelled: impl Fn() -> bool,
) -> Result<Parsed, String> {
    let input = EventInput {
        inner: BufReader::with_capacity(64 * 1024, input),
        event_bytes: 0,
        total_bytes: 0,
    };
    let mut reader = Reader::from_reader(input);
    let mut buffer = Vec::new();
    let mut retained = 0usize;
    let mut stack: Vec<Node> = Vec::new();
    let mut root = None;
    let mut count = 0;
    loop {
        if cancelled() {
            return Err("XML parsing cancelled or timed out".into());
        }
        buffer.clear();
        reader.get_mut().event_bytes = 0;
        let event = reader.read_event_into(&mut buffer).map_err(|error| match error {
            quick_xml::Error::Io(error) => error.to_string(),
            _ => "Malformed XML".into(),
        })?;
        // Validate all tokens, including comments, PI, declarations and end names.
        std::str::from_utf8(&buffer).map_err(|_| "Response is not UTF-8 XML")?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                count += 1;
                if count > MAX_NODES {
                    return Err("XML exceeds 8,000,000 node limit".into());
                }
                if stack.len() >= 32 {
                    return Err("XML nesting exceeds 32 levels".into());
                }
                // Conservative allowance for Node/Vec capacity and identity indexes.
                let member_budget = if e.name().as_ref() == b"Connection" { 2048 } else { 0 };
                charge(&mut retained, 256 + member_budget)?;
                charge(&mut retained, e.name().as_ref().len() * 2)?;
                let name = std::str::from_utf8(e.name().as_ref())
                    .map_err(|_| "Invalid XML name")?
                    .to_owned();
                let mut attrs = BTreeMap::new();
                for attr in e.attributes() {
                    let a = attr.map_err(|_| "Invalid or duplicate XML attribute")?;
                    let key = std::str::from_utf8(a.key.as_ref())
                        .map_err(|_| "Invalid XML attribute")?
                        .to_owned();
                    let val = a
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|_| "Invalid XML entity")?
                        .into_owned();
                    charge(&mut retained, 256 + 2 * (key.len() + val.len()))?;
                    attrs.insert(key, val);
                }
                let node = Node {
                    name,
                    attrs,
                    ..Default::default()
                };
                if empty {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else if root.replace(node).is_some() {
                        return Err("Multiple XML roots".into());
                    }
                } else {
                    stack.push(node);
                }
            }
            Event::End(_) => {
                let node = stack.pop().ok_or("Unbalanced XML")?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else if root.replace(node).is_some() {
                    return Err("Multiple XML roots".into());
                }
            }
            Event::Text(e) => {
                let decoded = e.decode().map_err(|_| "Invalid XML text")?;
                let text =
                    quick_xml::escape::unescape(&decoded).map_err(|_| "Invalid XML entity")?;
                if let Some(node) = stack.last_mut() {
                    charge(&mut retained, text.len() * 2)?;
                    node.text.push_str(&text);
                } else if !text.trim().is_empty() {
                    return Err("Text outside XML root".into());
                }
            }
            Event::CData(e) => {
                if let Some(node) = stack.last_mut() {
                    let text = e.decode().map_err(|_| "Invalid XML text")?;
                    charge(&mut retained, text.len() * 2)?;
                    node.text.push_str(&text);
                } else {
                    return Err("CDATA outside XML root".into());
                }
            }
            Event::DocType(_) => return Err("DTD is not permitted".into()),
            Event::GeneralRef(e) => {
                let decoded = e.decode().map_err(|_| "Invalid XML reference")?;
                let value = quick_xml::escape::unescape(&format!("&{decoded};"))
                    .map_err(|_| "Custom entities are not permitted")?
                    .into_owned();
                if let Some(node) = stack.last_mut() {
                    charge(&mut retained, value.len() * 2)?;
                    node.text.push_str(&value);
                } else {
                    return Err("Reference outside root".into());
                }
            }
            Event::Eof => break,
            Event::Decl(decl) => {
                if let Some(encoding) = decl.encoding() {
                    let encoding = encoding.map_err(|_| "Invalid XML encoding")?;
                    if !encoding.eq_ignore_ascii_case(b"UTF-8") {
                        return Err("Response is not UTF-8 XML".into());
                    }
                }
            }
            Event::Comment(_) | Event::PI(_) => {}
        }
    }
    if !stack.is_empty() {
        return Err("Truncated XML".into());
    }
    let mut root = root.ok_or("Empty XML")?;
    if root.name != "BlueCoatResponse" {
        return Err("Expected BlueCoatResponse XML, not HTML".into());
    }
    // Record the selected schema path so its payload can later be moved, not cloned.
    let index = |node: &Node, name: &str| node.children.iter().position(|n| n.name == name);
    let device_index = index(&root, "Device").ok_or("Missing Device")?;
    let device = &root.children[device_index];
    let stats_path = if let Some(i) = index(device, "Stats") {
        vec![device_index, i]
    } else {
        vec![index(&root, "Stats").ok_or("Missing Stats")?]
    };
    let stats = stats_path.iter().fold(&root, |node, &i| &node.children[i]);
    let proxied_path = if let Some(i) = index(stats, "ProxiedConnections") {
        let mut path = stats_path.clone();
        path.push(i);
        path
    } else if let Some(i) = index(device, "ProxiedConnections") {
        vec![device_index, i]
    } else {
        vec![index(&root, "ProxiedConnections").ok_or("Missing ProxiedConnections")?]
    };
    let proxied = proxied_path.iter().fold(&root, |node, &i| &node.children[i]);
    let total = proxied
        .child("Total")
        .or_else(|| stats.child("Total"))
        .ok_or("Missing Total")?;
    let reported_sessions = required_count(total, "DisplaySess")?;
    let reported_connections = required_count(total, "DisplayConn")?;
    let device_time = device.value("DeviceTime").map(str::to_owned);
    let device_key = hash(
        &serde_json::to_string(&[
            device.value("Type"),
            device.value("SerialNumber"),
            device.value("Address"),
        ])
        .unwrap_or_default(),
    );
    let mut members = Vec::new();
    let mut warnings = Vec::new();
    if stats.value("Status").is_some_and(|v| v != "Current") {
        warnings.push("Stats.Status is not Current; semantics unverified".into());
    }
    let proxied = proxied_path.into_iter().fold(&mut root, |node, i| &mut node.children[i]);
    let session_count = proxied.children.iter().filter(|n| n.name == "Session").count();
    for (session, group) in proxied.children.iter_mut().filter(|n| n.name == "Session").enumerate() {
        if cancelled() {
            return Err("XML parsing cancelled or timed out".into());
        }
        let (connections, metadata): (Vec<_>, Vec<_>) = std::mem::take(&mut group.children)
            .into_iter().partition(|n| n.name == "Connection");
        group.children = metadata;
        let primaries: Vec<_> = connections
            .iter()
            .filter(|n| n.value("Type") == Some("Primary"))
            .collect();
        let primary = primaries.first().copied();
        let base = primary
            .map(|n| {
                serde_json::to_string(&[
                    Some(device_key.as_str()),
                    n.field("Client", "Address"),
                    n.field("Client", "Port"),
                    n.field("Client", "LocalAddress"),
                    n.field("Client", "LocalPort"),
                    n.field("Client", "StartTime"),
                    n.value("Type"),
                ])
                .unwrap_or_default()
            })
            .unwrap_or_default();
        let parent = hash(&base);
        let primary_ambiguous = primaries.len() != 1
            || primary.is_none_or(|n| {
                ["Address", "Port", "LocalAddress", "LocalPort", "StartTime"]
                    .iter()
                    .any(|k| n.field("Client", k).is_none_or(str::is_empty))
            });
        for (ordinal, node) in connections.into_iter().enumerate() {
            if cancelled() {
                return Err("XML parsing cancelled or timed out".into());
            }
            let secondary = node.value("Type") == Some("Secondary");
            let key = if secondary {
                hash(
                    &serde_json::to_string(&[
                        Some(parent.as_str()),
                        node.value("Type"),
                        node.field("Server", "Address"),
                        node.field("Server", "Port"),
                        node.field("Server", "StartTime"),
                    ])
                    .unwrap_or_default(),
                )
            } else {
                parent.clone()
            };
            let ambiguous = primary_ambiguous
                || (secondary && node.field("Server", "StartTime").is_none_or(str::is_empty))
                || !matches!(node.value("Type"), Some("Primary" | "Secondary"));
            members.push(Member {
                key,
                parent: parent.clone(),
                session,
                ordinal,
                ambiguous,
                parent_ambiguous: primary_ambiguous,
                raw: node,
            });
        }
    }
    let mut frequencies = HashMap::new();
    let mut session_keys: HashMap<String, std::collections::HashSet<usize>> = HashMap::new();
    for m in &members {
        if cancelled() {
            return Err("XML parsing cancelled or timed out".into());
        }
        *frequencies.entry(m.key.clone()).or_insert(0usize) += 1;
        session_keys
            .entry(m.parent.clone())
            .or_default()
            .insert(m.session);
    }
    for m in &mut members {
        if cancelled() {
            return Err("XML parsing cancelled or timed out".into());
        }
        if session_keys[&m.parent].len() > 1 {
            m.parent_ambiguous = true;
        }
        if frequencies[&m.key] > 1 || m.parent_ambiguous {
            m.ambiguous = true;
        }
    }
    let clients = members
        .iter()
        .filter_map(|m| m.raw.field("Client", "Address"))
        .filter(|s| !s.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .len();
    if reported_sessions != session_count as i64 || reported_connections != members.len() as i64 {
        warnings.push("Reported totals differ from parsed Session/Connection counts".into());
    }
    if members.iter().any(|m| m.ambiguous) {
        warnings.push(
            "Some identities are ambiguous; no cross-sample identity claims for those members"
                .into(),
        );
    }
    // Retain unknown metadata but remove per-member payload and mask serials recursively.
    fn redact(node: &mut Node) {
        if let Some(value) = node.attrs.get_mut("SerialNumber") {
            *value = "[masked]".into();
        }
        if node.name == "SerialNumber" {
            node.text = "[masked]".into();
        }
        if node.name == "Session" {
            node.children.retain(|n| n.name != "Connection");
        }
        for child in &mut node.children {
            redact(child);
        }
        // Empty session shells are represented by parsed counts + observation ordinals.
        // If unexpected session-level fields exist, retain every shell in order so
        // the metadata remains associated with the correct snapshot session.
        if node.name == "ProxiedConnections"
            && !node.children.iter().any(|n| {
                n.name == "Session"
                    && (!n.attrs.is_empty() || !n.text.trim().is_empty() || !n.children.is_empty())
            })
        {
            node.children.retain(|n| n.name != "Session");
        }
    }
    redact(&mut root);
    if cancelled() {
        return Err("XML parsing cancelled or timed out".into());
    }
    Ok(Parsed {
        metadata: root,
        members,
        sessions: session_count,
        reported_sessions,
        reported_connections,
        clients,
        device_time,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_snapshot_preserves_every_connection_and_missing_counter() {
        let count = 24_000;
        let padding = "x".repeat(800);
        let mut xml = String::from("<BlueCoatResponse><Device><Stats><ProxiedConnections>");
        for i in 0..count {
            xml.push_str(&format!("<Session><Connection Type='Primary'><Client Address='192.0.2.1' Port='{i}' LocalAddress='192.0.2.2' LocalPort='8080' StartTime='{i}' Bytes='{i}'/><Details Text='{padding}'/></Connection></Session>"));
        }
        xml.push_str(&format!("<Total DisplaySess='{count}' DisplayConn='{count}'/></ProxiedConnections></Stats></Device></BlueCoatResponse>"));
        assert!(xml.len() > 16 * 1024 * 1024);
        let parsed = parse_reader(xml.as_bytes()).unwrap();
        assert_eq!(parsed.sessions, count);
        assert_eq!(parsed.members.len(), count);
        assert_eq!(parsed.reported_connections, count as i64);
        for (i, member) in parsed.members.iter().enumerate() {
            assert_eq!(member.session, i);
            assert_eq!(member.raw.field("Client", "Bytes"), Some(i.to_string().as_str()));
            assert_eq!(member.raw.field("Server", "Bytes"), None);
            assert_eq!(member.raw.field("Details", "Text"), Some(padding.as_str()));
        }
    }

    #[test]
    fn accepts_more_than_old_node_limit() {
        let mut xml = String::from("<BlueCoatResponse><Device><Stats>");
        xml.push_str(&"<Metric/>".repeat(500_001));
        xml.push_str("<ProxiedConnections><Total DisplaySess='0' DisplayConn='0'/></ProxiedConnections></Stats></Device></BlueCoatResponse>");
        let parsed = parse(&xml).unwrap();
        assert_eq!(parsed.metadata.child("Device").unwrap().child("Stats").unwrap().children.len(), 500_002);
    }

    #[test]
    fn streaming_limits_utf8_entities_and_cancellation() {
        // Even an unterminated token is stopped before quick-xml buffers the whole body.
        let oversized = std::io::Cursor::new(b"<!--").chain(std::io::repeat(b'x').take((MAX_EVENT_BYTES * 2) as u64));
        assert_eq!(parse_reader(oversized).err().as_deref(), Some("XML token exceeds 1 MiB limit"));
        let mut budget = MAX_RETAINED_BYTES;
        assert!(charge(&mut budget, 1).is_err());
        let mut input = EventInput {
            inner: BufReader::new(std::io::Cursor::new(b"x")),
            event_bytes: 0,
            total_bytes: MAX_DOCUMENT_BYTES,
        };
        assert!(input.fill_buf().is_err());
        for invalid in [
            b"<BlueCoatResponse><!--\xff--></BlueCoatResponse>".as_slice(),
            b"<BlueCoatResponse>&custom;</BlueCoatResponse>".as_slice(),
            b"<?xml version='1.0' encoding='ISO-8859-1'?><BlueCoatResponse/>".as_slice(),
        ] {
            assert!(parse_reader(invalid).is_err());
        }
        assert!(parse(&format!("{}{}", "<x>".repeat(33), "</x>".repeat(33))).is_err());
        assert!(parse_reader_controlled(super::super::mock::empty().as_bytes(), || true).is_err());
    }

    #[test]
    fn alternate_schema_locations_and_session_metadata_survive_moves() {
        for xml in [
            "<BlueCoatResponse><Device/><Stats><Total DisplaySess='1' DisplayConn='1'/></Stats><ProxiedConnections><Session Label='kept'><Connection Type='Primary'/><Extra Value='kept'/></Session></ProxiedConnections></BlueCoatResponse>",
            "<BlueCoatResponse><Device><ProxiedConnections><Session Label='kept'><Connection Type='Primary'/><Extra Value='kept'/></Session><Total DisplaySess='1' DisplayConn='1'/></ProxiedConnections></Device><Stats/></BlueCoatResponse>",
        ] {
            let parsed = parse(xml).unwrap();
            assert_eq!(parsed.sessions, 1);
            assert_eq!(parsed.members.len(), 1);
            let encoded = serde_json::to_string(&parsed.metadata).unwrap();
            assert!(encoded.contains("kept"));
            assert!(!encoded.contains("Primary"));
        }
    }

    #[test]
    fn synthetic_edge_cases() {
        let p = parse(&super::super::mock::xml(0)).unwrap();
        assert_eq!(p.sessions, 2);
        assert_eq!(p.members.len(), 4);
        assert_eq!(p.members[1].raw.field("Age", "Seconds"), Some("124.25"));
        assert_eq!(finite(Some("inf")), None);
        assert_eq!(p.members[0].raw.field("Server", "Active"), Some("0"));
    }
    #[test]
    fn rejects_html_dtd_and_truncation() {
        for input in [
            "<html>login</html>",
            "<!DOCTYPE x [<!ENTITY x 'bad'>]><x/>",
            "<BlueCoatResponse>",
        ] {
            assert!(parse(input).is_err());
        }
    }
    #[test]
    fn preserves_repeats_reset_port_reuse_and_missing_fields() {
        assert_eq!(super::super::mock::xml(0), super::super::mock::xml(1));
        let before = parse(&super::super::mock::xml(7)).unwrap();
        let reset = parse(&super::super::mock::xml(8)).unwrap();
        assert_eq!(before.members[0].key, reset.members[0].key);
        assert_eq!(reset.members[0].raw.field("Client", "Bytes"), Some("20"));
        let reused = parse(&super::super::mock::xml(16)).unwrap();
        assert_ne!(before.members[0].key, reused.members[0].key);
        assert!(reset.members[1].raw.child("Details").is_none());
        assert!(reset.members[0]
            .raw
            .field("Server", "RemoteAddress")
            .is_none());
        assert_eq!(reset.members[1].raw.field("Gain", "Value"), Some("inf"));
        assert_eq!(reset.members[2].raw.field("Gain", "Value"), Some("-nan"));
        assert_eq!(
            reset.members[3].raw.field("Gain", "CacheHit"),
            Some("false")
        );
    }
    #[test]
    fn totals_mismatch_is_not_hidden() {
        let xml = super::super::mock::empty().replace("DisplaySess='0'", "DisplaySess='1'");
        let p = parse(&xml).unwrap();
        assert_eq!(p.reported_sessions, 1);
        assert_eq!(p.sessions, 0);
        assert!(!p.warnings.is_empty());
    }
    #[test]
    fn valid_zero_is_a_sample() {
        let p = parse("<BlueCoatResponse><Device><Stats><ProxiedConnections><Total DisplaySess='0' DisplayConn='0'/></ProxiedConnections></Stats></Device></BlueCoatResponse>").unwrap();
        assert_eq!(p.reported_connections, 0);
    }
}
