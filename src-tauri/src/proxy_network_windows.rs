//! Permission fallback for Windows raw sockets. Uses IP Helper directly, never a process.
use std::{
    net::IpAddr,
    ptr,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{HANDLE, INVALID_HANDLE_VALUE},
    NetworkManagement::IpHelper::{
        Icmp6CreateFile, Icmp6SendEcho2, IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho,
        ICMPV6_ECHO_REPLY_LH, ICMP_ECHO_REPLY, IP_SUCCESS,
    },
    Networking::WinSock::{AF_INET6, IN6_ADDR, IN6_ADDR_0, SOCKADDR_IN6},
};

use super::{PingReport, PING_COUNT, PING_TIMEOUT};

struct IcmpHandle(HANDLE);

impl Drop for IcmpHandle {
    fn drop(&mut self) {
        // SAFETY: this guard owns the handle from Icmp[6]CreateFile and closes it once.
        unsafe {
            IcmpCloseHandle(self.0);
        }
    }
}

pub(super) async fn ping(ip: IpAddr) -> Result<PingReport, String> {
    // Synchronous Windows API calls have a per-request timeout. Keep them off Tokio workers.
    tokio::task::spawn_blocking(move || ping_blocking(ip))
        .await
        .map_err(|error| format!("Windows ICMP worker failed: {error}"))?
}

fn ping_blocking(ip: IpAddr) -> Result<PingReport, String> {
    // SAFETY: no input pointers are required to create an ICMP handle.
    let handle = unsafe {
        if ip.is_ipv4() {
            IcmpCreateFile()
        } else {
            Icmp6CreateFile()
        }
    };
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(format!(
            "Unable to open Windows ICMP handle: {}",
            std::io::Error::last_os_error()
        ));
    }
    let handle = IcmpHandle(handle);
    let mut report = PingReport {
        received: 0,
        log: "Windows IP Helper ICMP fallback (raw socket access denied)\n".into(),
    };
    let payload = [0_u8; 32];
    for sequence in 0..PING_COUNT {
        let started = Instant::now();
        // Aligned storage, large enough for either reply structure, data and the extra
        // eight bytes documented by IP Helper. Pointers remain valid until the sync call returns.
        let mut reply = [0_u64; 64];
        let reply_size = std::mem::size_of_val(&reply) as u32;
        let reply_ptr = reply.as_mut_ptr().cast();
        let timeout_ms = PING_TIMEOUT.as_millis() as u32;
        // SAFETY: valid owned handle; immutable payload and writable aligned reply buffer.
        // Passing null event/APC requests synchronous operation, so no pointers escape.
        let count = unsafe {
            match ip {
                IpAddr::V4(address) => IcmpSendEcho(
                    handle.0,
                    u32::from_ne_bytes(address.octets()),
                    payload.as_ptr().cast(),
                    payload.len() as u16,
                    ptr::null(),
                    reply_ptr,
                    reply_size,
                    timeout_ms,
                ),
                IpAddr::V6(address) => {
                    let source = SOCKADDR_IN6 {
                        sin6_family: AF_INET6,
                        ..Default::default()
                    };
                    let destination = SOCKADDR_IN6 {
                        sin6_family: AF_INET6,
                        sin6_addr: IN6_ADDR {
                            u: IN6_ADDR_0 {
                                Byte: address.octets(),
                            },
                        },
                        ..Default::default()
                    };
                    Icmp6SendEcho2(
                        handle.0,
                        ptr::null_mut(),
                        None,
                        ptr::null(),
                        &source,
                        &destination,
                        payload.as_ptr().cast(),
                        payload.len() as u16,
                        ptr::null(),
                        reply_ptr,
                        reply_size,
                        timeout_ms,
                    )
                }
            }
        };
        if count == 0 {
            report.log.push_str(&format!(
                "ICMP attempt {}: {}\n",
                sequence + 1,
                std::io::Error::last_os_error()
            ));
        } else {
            // SAFETY: a nonzero synchronous result initialized the family-specific reply.
            // Read the fixed header only; data pointers from the reply are never dereferenced.
            let (status, milliseconds) = unsafe {
                if ip.is_ipv4() {
                    let header = ptr::read_unaligned(reply.as_ptr().cast::<ICMP_ECHO_REPLY>());
                    (header.Status, header.RoundTripTime)
                } else {
                    let header = ptr::read_unaligned(reply.as_ptr().cast::<ICMPV6_ECHO_REPLY_LH>());
                    (header.Status, header.RoundTripTime)
                }
            };
            if status == IP_SUCCESS {
                report.received += 1;
                report
                    .log
                    .push_str(&format!("Reply from {ip}: time={milliseconds}ms\n"));
            } else {
                report.log.push_str(&format!(
                    "ICMP attempt {}: Windows IP status {status}\n",
                    sequence + 1
                ));
            }
        }
        if sequence + 1 < PING_COUNT {
            std::thread::sleep(Duration::from_secs(1).saturating_sub(started.elapsed()));
        }
    }
    report.log.push_str(&format!(
        "Packets: Sent = {PING_COUNT}, Received = {}, Lost = {}\n",
        report.received,
        PING_COUNT - report.received
    ));
    Ok(report)
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    #[ignore = "Manual Windows IPv4/IPv6 IP Helper smoke test"]
    async fn windows_icmp_loopback_without_raw_sockets() {
        for ip in ["127.0.0.1", "::1"] {
            let report = super::ping(ip.parse().unwrap()).await.unwrap();
            assert!(report.received > 0, "{ip}: {}", report.log);
        }
    }
}
