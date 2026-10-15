//! Appliance routing shared by automation and interactive sessions.
pub(crate) struct SshTarget {
    pub host: String,
    pub port: u16,
    pub startup: Option<&'static str>,
}
impl SshTarget {
    pub(crate) fn port(mocked: bool) -> u16 {
        if mocked {
            2222
        } else {
            22
        }
    }
    pub(crate) fn appliance(address: &str, mocked: bool) -> Result<Self, String> {
        if mocked {
            return Ok(Self {
                host: "127.0.0.1".into(),
                port: Self::port(true),
                startup: Some(r"powershell.exe -NoProfile -File C:\ssh-dummy\dummy.ps1"),
            });
        }
        let host = address.trim();
        if host.is_empty() || host.contains(['/', '\\', '@', '\n', '\r', ' ']) {
            return Err("Invalid appliance SSH address.".into());
        }
        Ok(Self {
            host: host.into(),
            port: Self::port(false),
            startup: None,
        })
    }
}
pub(crate) fn sgos_prompt_policy() -> crate::ssh_client::PromptPolicy {
    crate::ssh_client::PromptPolicy::new(
        r"^([A-Za-z0-9_. /:-]{1,120})([>#])(?:\(config[^\r\n]*\))?$",
        &[">", "#", "#(config)"],
    )
    .expect("Valid SGOS prompt policy")
}
