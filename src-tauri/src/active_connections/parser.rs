use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};

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
/// Event parser: bounded tree, no DTD, no external/custom entities, no HTML recovery.
pub fn parse(xml: &str) -> Result<Parsed, String> {
    if xml.len() > 16 * 1024 * 1024 {
        return Err("XML exceeds 16 MiB".into());
    }
    let mut reader = Reader::from_str(xml);
    let mut stack: Vec<Node> = Vec::new();
    let mut root = None;
    let mut count = 0;
    loop {
        let event = reader.read_event().map_err(|_| "Malformed XML")?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                count += 1;
                if count > 500_000 || stack.len() >= 32 {
                    return Err("XML complexity limit exceeded".into());
                }
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
                    node.text.push_str(&text);
                } else if !text.trim().is_empty() {
                    return Err("Text outside XML root".into());
                }
            }
            Event::CData(e) => {
                if let Some(node) = stack.last_mut() {
                    node.text
                        .push_str(&e.decode().map_err(|_| "Invalid XML text")?);
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
                    node.text.push_str(&value);
                } else {
                    return Err("Reference outside root".into());
                }
            }
            Event::Eof => break,
            Event::Decl(_) | Event::Comment(_) | Event::PI(_) => {}
        }
    }
    if !stack.is_empty() {
        return Err("Truncated XML".into());
    }
    let mut root = root.ok_or("Empty XML")?;
    if root.name != "BlueCoatResponse" {
        return Err("Expected BlueCoatResponse XML, not HTML".into());
    }
    let device = root.child("Device").ok_or("Missing Device")?;
    let stats = device
        .child("Stats")
        .or_else(|| root.child("Stats"))
        .ok_or("Missing Stats")?;
    let proxied = stats
        .child("ProxiedConnections")
        .or_else(|| device.child("ProxiedConnections"))
        .or_else(|| root.child("ProxiedConnections"))
        .ok_or("Missing ProxiedConnections")?;
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
    let sessions: Vec<_> = proxied
        .children
        .iter()
        .filter(|n| n.name == "Session")
        .collect();
    let mut members = Vec::new();
    let mut warnings = Vec::new();
    if stats.value("Status").is_some_and(|v| v != "Current") {
        warnings.push("Stats.Status is not Current; semantics unverified".into());
    }
    for (session, group) in sessions.iter().enumerate() {
        let connections: Vec<_> = group
            .children
            .iter()
            .filter(|n| n.name == "Connection")
            .collect();
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
        for (ordinal, node) in connections.iter().enumerate() {
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
                raw: (*node).clone(),
            });
        }
    }
    let mut frequencies = HashMap::new();
    let mut session_keys: HashMap<String, std::collections::HashSet<usize>> = HashMap::new();
    for m in &members {
        *frequencies.entry(m.key.clone()).or_insert(0usize) += 1;
        session_keys
            .entry(m.parent.clone())
            .or_default()
            .insert(m.session);
    }
    for m in &mut members {
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
    if reported_sessions != sessions.len() as i64 || reported_connections != members.len() as i64 {
        warnings.push("Reported totals differ from parsed Session/Connection counts".into());
    }
    if members.iter().any(|m| m.ambiguous) {
        warnings.push(
            "Some identities are ambiguous; no cross-sample identity claims for those members"
                .into(),
        );
    }
    let session_count = sessions.len();
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
