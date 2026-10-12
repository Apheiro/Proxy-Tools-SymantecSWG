//! Native proxy discovery. IPC field names remain compatible with saved inventories.
use std::{
    future::Future,
    net::IpAddr,
    sync::atomic::{AtomicU16, Ordering},
    time::Duration,
};

use chrono::Utc;
use hickory_resolver::TokioResolver;
use serde::Serialize;
use surge_ping::{Client, Config, PingIdentifier, PingSequence, ICMP};
use tokio::time::timeout;

const DNS_TIMEOUT: Duration = Duration::from_secs(5);
const PING_TIMEOUT: Duration = Duration::from_secs(4);
const PING_COUNT: u16 = 4;
static NEXT_IDENTIFIER: AtomicU16 = AtomicU16::new(1);

#[cfg(windows)]
#[path = "proxy_network_windows.rs"]
mod windows_icmp;

#[derive(Debug, Serialize)]
pub(crate) struct TraceLog {
    pub pinglog: String,
    pub hostname: String,
    pub nslookup: String,
    pub active: bool,
    pub last_check: String,
    pub hostinfo: HostInfo,
    pub registered_address: String,
    pub primary_address: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct HostInfo {
    pub hostname: String,
    pub ip: String,
    pub dnsname: String,
    pub dnsip: String,
}

struct ReverseInfo {
    hostname: Option<String>,
    // Configured DNS endpoints, not an assertion about which server answered.
    servers: String,
    diagnostic: String,
}

#[derive(Default)]
struct PingReport {
    received: u16,
    log: String,
}

// Keep orchestration testable without real DNS, privileged sockets or external processes.
trait Network {
    fn forward(&self, host: &str) -> impl Future<Output = Result<Vec<IpAddr>, String>>;
    fn reverse(&self, ip: IpAddr) -> impl Future<Output = ReverseInfo>;
    fn ping(&self, ip: IpAddr) -> impl Future<Output = Result<PingReport, String>>;
}

struct NativeNetwork;

async fn bounded<T>(
    operation: &str,
    duration: Duration,
    future: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    timeout(duration, future)
        .await
        .map_err(|_| format!("{operation} timed out"))?
}

impl Network for NativeNetwork {
    async fn forward(&self, host: &str) -> Result<Vec<IpAddr>, String> {
        // Uses the OS resolver (including hosts files/search rules), not a raw A/AAAA query.
        bounded("System hostname resolution", DNS_TIMEOUT, async {
            let addresses = tokio::net::lookup_host((host, 0))
                .await
                .map_err(|e| e.to_string())?;
            let mut ips = Vec::new();
            for address in addresses {
                if !ips.contains(&address.ip()) {
                    ips.push(address.ip());
                }
            }
            if ips.is_empty() {
                return Err("System resolver returned no addresses".into());
            }
            Ok(ips)
        })
        .await
    }

    async fn reverse(&self, ip: IpAddr) -> ReverseInfo {
        let result = (|| {
            let mut builder = TokioResolver::builder_tokio().map_err(|e| e.to_string())?;
            builder.options_mut().timeout = DNS_TIMEOUT;
            builder.options_mut().attempts = 1;
            Ok::<_, String>(builder.build())
        })();
        let resolver = match result {
            Ok(resolver) => resolver,
            Err(error) => {
                return ReverseInfo {
                    hostname: None,
                    servers: "unknown".into(),
                    diagnostic: format!("PTR resolver configuration failed: {error}"),
                }
            }
        };
        reverse_with(&resolver, ip, DNS_TIMEOUT).await
    }

    async fn ping(&self, ip: IpAddr) -> Result<PingReport, String> {
        let config = Config::builder()
            .kind(if ip.is_ipv4() { ICMP::V4 } else { ICMP::V6 })
            .build();
        let client = match Client::new(&config) {
            Ok(client) => client,
            Err(error) => {
                #[cfg(windows)]
                if error.kind() == std::io::ErrorKind::PermissionDenied
                    || error.raw_os_error() == Some(10013)
                {
                    return windows_icmp::ping(ip).await;
                }
                return Err(format!("Unable to open ICMP socket: {error}. Raw ICMP may require administrator privileges or CAP_NET_RAW; check OS socket permissions."));
            }
        };
        let mut pinger = client
            .pinger(
                ip,
                PingIdentifier(NEXT_IDENTIFIER.fetch_add(1, Ordering::Relaxed)),
            )
            .await;
        pinger.timeout(PING_TIMEOUT);
        let mut report = PingReport::default();
        for sequence in 0..PING_COUNT {
            let started = tokio::time::Instant::now();
            match timeout(
                PING_TIMEOUT + Duration::from_millis(100),
                pinger.ping(PingSequence(sequence), &[0; 32]),
            )
            .await
            {
                Ok(Ok((_, rtt))) => {
                    report.received += 1;
                    report.log.push_str(&format!(
                        "Reply from {ip}: time={:.2}ms\n",
                        rtt.as_secs_f64() * 1000.0
                    ));
                }
                Ok(Err(error)) => report
                    .log
                    .push_str(&format!("ICMP attempt {}: {error}\n", sequence + 1)),
                Err(_) => report
                    .log
                    .push_str(&format!("ICMP attempt {}: timed out\n", sequence + 1)),
            }
            if sequence + 1 < PING_COUNT {
                tokio::time::sleep(Duration::from_secs(1).saturating_sub(started.elapsed())).await;
            }
        }
        report.log.push_str(&format!(
            "Packets: Sent = {PING_COUNT}, Received = {}, Lost = {}\n",
            report.received,
            PING_COUNT - report.received
        ));
        Ok(report)
    }
}

async fn reverse_with(resolver: &TokioResolver, ip: IpAddr, deadline: Duration) -> ReverseInfo {
    let mut servers = Vec::new();
    for server in resolver.config().name_servers() {
        let address = server.socket_addr.ip().to_string();
        if !servers.contains(&address) {
            servers.push(address);
        }
    }
    let servers = if servers.is_empty() {
        "unknown".into()
    } else {
        servers.join(" ")
    };
    let result = bounded("PTR lookup", deadline, async {
        let records = resolver
            .reverse_lookup(ip)
            .await
            .map_err(|e| e.to_string())?;
        records
            .iter()
            .map(|name| name.to_utf8().trim_end_matches('.').to_string())
            .find(|name| !name.is_empty())
            .ok_or_else(|| "No PTR record returned".into())
    })
    .await;
    match result {
        Ok(hostname) => ReverseInfo {
            hostname: Some(hostname.clone()),
            servers,
            diagnostic: format!("PTR: {ip} -> {hostname}"),
        },
        Err(error) => ReverseInfo {
            hostname: None,
            servers,
            diagnostic: format!("PTR unavailable for {ip}: {error}"),
        },
    }
}

pub(crate) async fn check_proxy(host: &str) -> Result<TraceLog, String> {
    check_with(&NativeNetwork, host).await
}

async fn check_with(network: &impl Network, host: &str) -> Result<TraceLog, String> {
    let host = host.trim();
    if host.is_empty() || host.chars().any(char::is_whitespace) || host.contains(['/', '\\']) {
        return Err("Enter a hostname or IP address without a URL, port or whitespace".into());
    }
    let literal = host.parse::<IpAddr>().ok();
    if literal.is_none() && host.contains(':') {
        return Err("Invalid IP address or hostname (ports are not supported)".into());
    }
    let mut dnslog = String::new();
    let ips = match literal {
        Some(ip) => vec![ip],
        None => match network.forward(host).await {
            Ok(ips) => ips,
            Err(error) => {
                dnslog = format!("System resolver can't find {host}: {error}\n");
                Vec::new()
            }
        },
    };
    let ip_text = if ips.is_empty() {
        "unknown".into()
    } else {
        ips.iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(" ")
    };
    // Prefer IPv4 like the existing Windows ping; retain all resolved addresses in hostinfo.
    let target = ips.iter().find(|ip| ip.is_ipv4()).or(ips.first()).copied();
    let (reverse, ping) = if let Some(ip) = target {
        let (reverse, ping) = tokio::join!(network.reverse(ip), network.ping(ip));
        (Some(reverse), ping)
    } else {
        (
            None,
            Ok(PingReport {
                received: 0,
                log: "ICMP skipped: no resolved address\n".into(),
            }),
        )
    };
    let mut pinglog = match target {
        Some(ip) => format!("Pinging {host} [{ip}] with 32 bytes of data:\n"),
        None => format!("Ping request could not find host {host}.\n"),
    };
    let active = match ping {
        Ok(report) => {
            pinglog.push_str(&report.log);
            report.received > 0
        }
        Err(error) => {
            pinglog.push_str(&format!("ICMP check unavailable: {error}\n"));
            false
        }
    };
    let ptr = reverse.as_ref().and_then(|r| r.hostname.as_deref());
    // A PTR name identifies an IP. Named registrations retain their OS-resolved input name.
    let full_hostname = if literal.is_some() {
        ptr.unwrap_or("unknown")
    } else {
        host
    };
    let display_hostname = if (literal.is_some() && ptr.is_none()) || target.is_none() {
        host.to_string()
    } else {
        full_hostname.split('.').next().unwrap_or(host).to_string()
    };
    dnslog.push_str(&format!(
        "Resolution: {host}\nName: {full_hostname}\nAddresses: {ip_text}\n"
    ));
    if let Some(reverse) = &reverse {
        dnslog.push_str(&format!(
            "Configured DNS servers: {}\n{}\n",
            reverse.servers, reverse.diagnostic
        ));
    }
    Ok(TraceLog {
        pinglog,
        hostname: display_hostname,
        nslookup: dnslog,
        active,
        last_check: Utc::now().to_rfc3339(),
        hostinfo: HostInfo {
            hostname: full_hostname.to_string(),
            ip: ip_text,
            dnsname: "unknown".into(),
            dnsip: reverse
                .map(|r| r.servers)
                .unwrap_or_else(|| "unknown".into()),
        },
        registered_address: host.to_string(),
        primary_address: if literal.is_some() || !active || ips.len() != 1 {
            host.to_string()
        } else {
            ips[0].to_string()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeNetwork {
        ips: Result<Vec<IpAddr>, String>,
        ptr: Option<String>,
        received: u16,
        ping_error: Option<String>,
    }

    impl Default for FakeNetwork {
        fn default() -> Self {
            Self {
                ips: Ok(vec!["192.0.2.10".parse().unwrap()]),
                ptr: None,
                received: 4,
                ping_error: None,
            }
        }
    }

    impl Network for FakeNetwork {
        async fn forward(&self, _: &str) -> Result<Vec<IpAddr>, String> {
            self.ips.clone()
        }
        async fn reverse(&self, _: IpAddr) -> ReverseInfo {
            ReverseInfo {
                hostname: self.ptr.clone(),
                servers: "192.0.2.53".into(),
                diagnostic: "PTR test result".into(),
            }
        }
        async fn ping(&self, _: IpAddr) -> Result<PingReport, String> {
            match &self.ping_error {
                Some(error) => Err(error.clone()),
                None => Ok(PingReport {
                    received: self.received,
                    log: "test ICMP report".into(),
                }),
            }
        }
    }

    #[tokio::test]
    async fn named_registration_keeps_identity_and_uses_single_reachable_ip() {
        let result = check_with(&FakeNetwork::default(), " proxy.example.test ")
            .await
            .unwrap();
        assert_eq!(result.registered_address, "proxy.example.test");
        assert_eq!(result.primary_address, "192.0.2.10");
        assert_eq!(result.hostname, "proxy");
        assert_eq!(result.hostinfo.hostname, "proxy.example.test");
        assert!(result.active);
        assert!(result
            .pinglog
            .contains("Pinging proxy.example.test [192.0.2.10]"));
        assert!(chrono::DateTime::parse_from_rfc3339(&result.last_check).is_ok());
        let fields = serde_json::to_value(result).unwrap();
        for name in [
            "pinglog",
            "hostname",
            "nslookup",
            "active",
            "last_check",
            "hostinfo",
            "registered_address",
            "primary_address",
        ] {
            assert!(fields.get(name).is_some(), "missing IPC field {name}");
        }
    }

    #[tokio::test]
    async fn literal_without_ptr_remains_usable_and_unknown_name_is_explicit() {
        let result = check_with(
            &FakeNetwork {
                ips: Err("must not resolve literals".into()),
                ..Default::default()
            },
            "2001:db8::1",
        )
        .await
        .unwrap();
        assert_eq!(result.hostinfo.ip, "2001:db8::1");
        assert_eq!(result.primary_address, "2001:db8::1");
        assert_eq!(result.hostname, "2001:db8::1");
        assert_eq!(result.hostinfo.hostname, "unknown");
        assert!(result.active);
    }

    #[tokio::test]
    async fn literal_with_ptr_gets_short_display_name_and_keeps_ip() {
        let result = check_with(
            &FakeNetwork {
                ptr: Some("proxy.example.test".into()),
                ..Default::default()
            },
            "192.0.2.10",
        )
        .await
        .unwrap();
        assert_eq!(result.hostname, "proxy");
        assert_eq!(result.hostinfo.hostname, "proxy.example.test");
        assert_eq!(result.primary_address, "192.0.2.10");
    }

    #[tokio::test]
    async fn dns_failure_keeps_registration_and_reports_inactive_without_panicking() {
        let result = check_with(
            &FakeNetwork {
                ips: Err("no DNS response".into()),
                ..Default::default()
            },
            "missing.example.test",
        )
        .await
        .unwrap();
        assert!(!result.active);
        assert_eq!(result.hostinfo.ip, "unknown");
        assert_eq!(result.primary_address, "missing.example.test");
        assert!(result.nslookup.contains("no DNS response"));
        assert!(result.pinglog.contains("ICMP skipped"));
    }

    #[tokio::test]
    async fn multiple_addresses_keep_hostname_as_primary_and_prefer_ipv4_for_ping() {
        let result = check_with(
            &FakeNetwork {
                ips: Ok(vec![
                    "2001:db8::1".parse().unwrap(),
                    "192.0.2.10".parse().unwrap(),
                ]),
                ..Default::default()
            },
            "proxy.example.test",
        )
        .await
        .unwrap();
        assert_eq!(result.hostinfo.ip, "2001:db8::1 192.0.2.10");
        assert_eq!(result.primary_address, "proxy.example.test");
        assert!(result.pinglog.contains("[192.0.2.10]"));
    }

    #[tokio::test]
    async fn partial_reply_is_reachable_but_zero_replies_is_inactive() {
        for received in [0, 1, 4] {
            let result = check_with(
                &FakeNetwork {
                    received,
                    ..Default::default()
                },
                "proxy.example.test",
            )
            .await
            .unwrap();
            assert_eq!(result.active, received > 0);
            if received == 0 {
                assert_eq!(result.primary_address, "proxy.example.test");
            }
        }
    }

    #[tokio::test]
    async fn icmp_permission_failure_does_not_prevent_registration_or_dns_discovery() {
        let result = check_with(
            &FakeNetwork {
                ping_error: Some("permission denied".into()),
                ..Default::default()
            },
            "proxy.example.test",
        )
        .await
        .unwrap();
        assert!(!result.active);
        assert!(result
            .pinglog
            .contains("ICMP check unavailable: permission denied"));
        assert_eq!(result.hostinfo.ip, "192.0.2.10");
    }

    #[tokio::test]
    async fn invalid_inputs_are_rejected_before_network_work() {
        for host in [
            "",
            "  ",
            "https://proxy.test",
            "proxy.test:8082",
            "proxy test",
            "2001:invalid",
            "proxy\\test",
        ] {
            assert!(
                check_with(&FakeNetwork::default(), host).await.is_err(),
                "accepted {host}"
            );
        }
    }

    #[tokio::test]
    async fn dns_timeout_is_bounded() {
        let result =
            bounded::<()>("Test DNS", Duration::from_millis(1), std::future::pending()).await;
        assert_eq!(result.unwrap_err(), "Test DNS timed out");
    }

    #[tokio::test]
    async fn os_resolver_supports_localhost_without_external_dns() {
        let addresses = NativeNetwork.forward("localhost").await.unwrap();
        assert!(!addresses.is_empty());
        assert!(addresses.iter().any(IpAddr::is_loopback));
    }

    // Exercise Hickory against a local DNS server, including its actual PTR wire query.
    async fn local_ptr(ip: IpAddr, response: Option<Option<&str>>) -> ReverseInfo {
        use hickory_resolver::{
            config::{NameServerConfig, ResolverConfig},
            name_server::TokioConnectionProvider,
            proto::{
                op::{Message, MessageType, ResponseCode},
                rr::{rdata::PTR, Name, RData, Record, RecordType},
                xfer::Protocol,
            },
        };
        let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        let mut config = ResolverConfig::new();
        config.add_name_server(NameServerConfig::new(address, Protocol::Udp));
        let mut builder =
            TokioResolver::builder_with_config(config, TokioConnectionProvider::default());
        builder.options_mut().attempts = 1;
        builder.options_mut().timeout = Duration::from_millis(200);
        let resolver = builder.build();
        let ptr_name = response.flatten().map(str::to_string);
        let answer = response.is_some();
        let server = tokio::spawn(async move {
            let mut buffer = [0; 2048];
            let (size, peer) = socket.recv_from(&mut buffer).await.unwrap();
            let request = Message::from_vec(&buffer[..size]).unwrap();
            let query = request.queries().first().unwrap();
            assert_eq!(query.query_type(), RecordType::PTR);
            let expected: Name = ip.into();
            assert_eq!(query.name(), &expected);
            if answer {
                let mut reply = Message::new();
                reply
                    .set_id(request.id())
                    .set_message_type(MessageType::Response)
                    .set_recursion_desired(true)
                    .set_recursion_available(true)
                    .add_query(query.clone());
                if let Some(name) = ptr_name {
                    reply.add_answer(Record::from_rdata(
                        query.name().clone(),
                        60,
                        RData::PTR(PTR(Name::from_ascii(name).unwrap())),
                    ));
                } else {
                    reply.set_response_code(ResponseCode::NXDomain);
                }
                socket
                    .send_to(&reply.to_vec().unwrap(), peer)
                    .await
                    .unwrap();
            } else {
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
        });
        let result = reverse_with(&resolver, ip, Duration::from_millis(100)).await;
        server.await.unwrap();
        result
    }

    #[tokio::test]
    async fn ptr_queries_ipv4_and_ipv6_and_normalizes_trailing_dot() {
        for ip in ["192.0.2.10", "2001:db8::1"] {
            let result = local_ptr(ip.parse().unwrap(), Some(Some("proxy.example.test."))).await;
            assert_eq!(result.hostname.as_deref(), Some("proxy.example.test"));
            assert_eq!(result.servers, "127.0.0.1");
        }
    }

    #[tokio::test]
    async fn absent_ptr_and_unresponsive_dns_are_nonfatal() {
        for response in [Some(None), None] {
            let result = local_ptr("192.0.2.10".parse().unwrap(), response).await;
            assert!(result.hostname.is_none());
            assert!(result.diagnostic.contains("PTR unavailable"));
            if response.is_none() {
                assert!(result.diagnostic.contains("timed out"));
            }
        }
    }

    #[tokio::test]
    #[ignore = "Requires ICMP socket permission; manual native ping smoke test"]
    async fn native_icmp_loopback() {
        for ip in ["127.0.0.1", "::1"] {
            let report = NativeNetwork.ping(ip.parse().unwrap()).await.unwrap();
            assert!(report.received > 0, "{ip}: {}", report.log);
        }
    }
}
