//! Deterministic synthetic data only: RFC 5737 and .invalid, never a real appliance.
pub fn xml(tick: u64) -> String {
    let bytes = if tick % 12 == 8 {
        20
    } else {
        2902 + (tick / 2) * 140
    };
    let start = if tick >= 16 {
        "2026-01-01T00:05:00Z"
    } else {
        "2026-01-01T00:00:00Z"
    };
    format!(
        r#"<?xml version="1.0"?><BlueCoatResponse><Device Type="Synthetic" SerialNumber="SYNTHETIC-ONLY" Name="proxy.invalid" Address="192.0.2.1" OSVersion="synthetic" DeviceTime="2026-01-01T00:00:00Z"><Stats AccessPath="/AS/ProxiedConnections" Description="Synthetic snapshot" Status="Current"><ProxiedConnections>
<Session><Connection Type="Primary" Error="0"><Gain Value="1.11" Savings="9.89"/><Client Address="192.0.2.10" Port="51000" RemoteAddress="192.0.2.10" RemotePort="51000" LocalAddress="192.0.2.1" LocalPort="8080" AddressInfo="" Bytes="{bytes}" Active="1" StartTime="{start}"/><Server Address="" Port="0" AddressInfo="" Bytes="2615" Active="0" EndTime="2026-01-01T00:00:01Z"/><Age Seconds="Active"/><Duration Seconds="1084344.069"/><Routing SOCKS="0" SOCKSInfo=":0" Forwarding="0" ForwardingInfo="" FromCache="0" FromCacheInfo=""/><Service Name="Synthetic service" Application="none" Protocol="SSL"/><ICAPREQMOD Status="1"/><ICAPRESPMOD Status="0"/><Acceleration ObjectCache="2" Latency="2" BandwidthManagement="0"/><Details Subsystem="HTTP" Error="false" Text=""/></Connection>
<Connection Type="Secondary" Error="0"><Gain Value="inf" Savings="-nan"/><Client Address="192.0.2.10" Port="51000" Bytes="100" Active="0"/><Server Address="198.51.100.20" Port="443" Bytes="100" Active="0" StartTime="2026-01-01T00:00:01Z" EndTime="2026-01-01T00:02:05Z"/><Age Seconds="124.25"/><Duration Seconds="124.25"/><Service Name="Synthetic service" Application="" Protocol="SSL"/></Connection>
<Connection Type="Secondary" Error="7"><Gain Value="-nan" Savings="-nan"/><Client Address="192.0.2.10" Port="51000" Bytes="40" Active="0"/><Server Address="198.51.100.21" Port="8443" Bytes="50" Active="0" StartTime="2026-01-01T00:00:02Z"/><Age Seconds="124.5"/><Duration Seconds="124.5"/></Connection></Session>
<Session><Connection Type="Primary" Error="0"><Gain CacheHit="false"/><Client Address="192.0.2.11" Port="52000" LocalAddress="192.0.2.1" LocalPort="8080" Bytes="400" Active="1" StartTime="2026-01-01T00:00:00Z"/><Server Address="203.0.113.30" Port="80" Bytes="300" Active="1" StartTime="2026-01-01T00:00:00Z"/><Age Seconds="Active"/><Duration Seconds="2.5"/><Service Name="Other synthetic service" Application="Synthetic browser" Protocol="HTTP"/></Connection></Session><Total DisplaySess="2" DisplayConn="4"/></ProxiedConnections></Stats></Device></BlueCoatResponse>"#
    )
}

pub fn empty() -> String {
    "<BlueCoatResponse><Device Type='Synthetic' SerialNumber='SYNTHETIC-ONLY' DeviceTime='2026-01-01T00:00:00Z'><Stats Status='Current'><ProxiedConnections><Total DisplaySess='0' DisplayConn='0'/></ProxiedConnections></Stats></Device></BlueCoatResponse>".into()
}
