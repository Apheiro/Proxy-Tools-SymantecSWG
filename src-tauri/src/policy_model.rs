//! Lossless CPL documents. Structural checks are not a replacement for SGOS compilation.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use similar::{ChangeTag, TextDiff};
pub(crate) const LIMIT: usize = 4 * 1024 * 1024;
pub(crate) fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub(crate) fn canonical(value: &str) -> String {
    value
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .trim_end_matches('\n')
        .to_owned()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Health {
    pub healthy: bool,
    pub issues: Vec<String>,
    pub warnings: Vec<String>,
}
pub(crate) fn health(text: &str) -> Health {
    let mut issues = Vec::new();
    let mut warnings =
        vec!["Structural checks only. SGOS compiles the complete CPL when it is installed.".into()];
    if text.len() > LIMIT {
        issues.push("CPL exceeds the 4 MiB document limit; nothing was truncated.".into());
    }
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        issues.push("Document contains unsupported control characters.".into());
    }
    let lower = text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .to_ascii_lowercase();
    if ["<!doctype", "<html", "<?xml", "!- version:", "error:", "% "]
        .iter()
        .any(|v| lower.starts_with(v))
    {
        issues.push("Response is not a Local Policy CPL source.".into());
    }
    let mut definition = false;
    let mut recognized = false;
    for line in text.lines() {
        let line = line
            .trim_start_matches('\u{feff}')
            .trim()
            .to_ascii_lowercase();
        if line.is_empty() || line.starts_with(';') {
            continue;
        }
        // Definition bodies can contain literal HTML and arbitrary strings.
        // Only their line-based terminator is structural at this level.
        static END: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
            regex::Regex::new(r#"^end(?:\s+[^;]+?)?\s*(?:;.*)?$"#).expect("valid CPL end pattern")
        });
        if definition {
            if END.is_match(&line) {
                definition = false;
            }
            continue;
        }
        if [
            "<html",
            "<head",
            "<body",
            "<?xml",
            "<!doctype",
            "</",
            "<vpm",
        ]
        .iter()
        .any(|prefix| line.starts_with(prefix))
        {
            issues.push("HTML/XML is not a Local Policy CPL source.".into());
        }
        if !recognized && !line.starts_with("define ") && !line.starts_with('<') {
            warnings.push(
                "Text before the first CPL layer or definition was preserved; review its syntax."
                    .into(),
            );
        }
        if line.starts_with("define ") {
            if definition {
                issues.push("Nested or unterminated definition requires review.".into());
            }
            definition = true;
            recognized = true;
        } else if END.is_match(&line) {
            issues.push("Unexpected definition terminator.".into());
        } else if line.starts_with('<') && line.contains('>') && !line.starts_with("</") {
            recognized = true;
        }
    }
    if definition {
        issues.push("Unterminated definition block.".into());
    }
    if !canonical(text).trim().is_empty()
        && !recognized
        && text
            .lines()
            .any(|l| !l.trim().is_empty() && !l.trim().starts_with(';'))
    {
        issues.push("No CPL layer or definition was found. Review the source format.".into());
    }
    if text.trim().is_empty() {
        warnings.push("The current Local Policy is empty. Empty replacement is disabled.".into());
    }
    Health {
        healthy: issues.is_empty(),
        issues,
        warnings,
    }
}
/// Keep every unchanged line's original bytes, including mixed EOLs and BOM.
pub(crate) fn edit(original: &str, draft: &str) -> Result<String, String> {
    if draft.len() > LIMIT {
        return Err("CPL exceeds 4 MiB.".into());
    }
    let bom = original.starts_with('\u{feff}');
    let raw = original.trim_start_matches('\u{feff}');
    let normalized = raw.replace("\r\n", "\n");
    let draft = draft.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let originals: Vec<&str> = raw.split_inclusive('\n').collect();
    let newline = if raw.matches("\r\n").count() > raw.matches('\n').count() / 2 {
        "\r\n"
    } else {
        "\n"
    };
    let mut result = if bom {
        "\u{feff}".to_owned()
    } else {
        String::new()
    };
    for change in TextDiff::configure()
        .timeout(std::time::Duration::from_secs(2))
        .diff_lines(&normalized, &draft)
        .iter_all_changes()
    {
        match change.tag() {
            ChangeTag::Equal => result.push_str(originals[change.old_index().unwrap()]),
            ChangeTag::Insert => result.push_str(&change.value().replace('\n', newline)),
            ChangeTag::Delete => (),
        }
    }
    let check = health(&result);
    if !check.healthy {
        return Err(check.issues.join(" "));
    }
    if canonical(&result).trim().is_empty() {
        return Err("Empty policy replacement is disabled.".into());
    }
    Ok(result)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiffLine {
    pub kind: &'static str,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
    pub text: String,
}
pub(crate) fn diff(old: &str, new: &str) -> Vec<DiffLine> {
    TextDiff::configure()
        .timeout(std::time::Duration::from_secs(2))
        .diff_lines(old, new)
        .iter_all_changes()
        .map(|c| DiffLine {
            kind: match c.tag() {
                ChangeTag::Equal => "equal",
                ChangeTag::Delete => "delete",
                ChangeTag::Insert => "insert",
            },
            old_line: c.old_index().map(|i| i + 1),
            new_line: c.new_index().map(|i| i + 1),
            text: c.value().into(),
        })
        .collect()
}
pub(crate) fn delimiter(text: &str) -> String {
    let mut d = format!("PROXYTOOLS_{}", &hash(text)[..20]);
    while text.lines().any(|l| l.trim_end_matches('\r') == d) {
        d.push('_');
    }
    d
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_mixed_endings_and_unknown_rules() {
        let s = "\u{feff}; comment\r\n<Proxy>\nurl.domain=example.com allow\r\n";
        assert_eq!(
            edit(s, "; comment\n<Proxy>\nurl.domain=example.com allow\n").unwrap(),
            s
        );
        let changed = edit(s, "; comment\n<Proxy>\nurl.domain=example.org deny\n").unwrap();
        assert!(changed.starts_with("\u{feff}; comment\r\n<Proxy>\n"));
        assert!(changed.ends_with("deny\r\n"));
    }
    #[test]
    fn rejects_wrappers_and_incomplete_definitions() {
        assert!(!health("<html>login</html>").healthy);
        assert!(!health("define condition foo\nurl.domain=x\n").healthy);
        assert!(health("; custom\n<Proxy>\nunknown.property=x deny\n").healthy);
        assert!(edit("<Proxy>\nallow\n", "").is_err());
    }
    #[test]
    fn literal_html_and_named_definition_terminators_are_valid_source() {
        assert!(health("define string Page\n<html>\n<body>test</body>\n</html>\nend string Page ; retained\n<Proxy>\nallow\n").healthy);
        assert!(health("define condition Clients\nclient.address=192.0.2.0/24\nend condition Clients\n<Proxy>\ncondition=Clients allow\n").healthy);
    }
    #[test]
    fn diff_tracks_source_lines() {
        let d = diff("a\nb\n", "a\nc\n");
        assert_eq!(d.len(), 3);
        assert_eq!(d[1].kind, "delete");
        assert_eq!(d[2].new_line, Some(2));
        assert_eq!(
            canonical("<Proxy>\r\nallow\r\n"),
            canonical("<Proxy>\nallow")
        );
    }
}
