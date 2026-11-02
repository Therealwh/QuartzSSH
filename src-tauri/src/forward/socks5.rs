//! Minimal SOCKS5 state machine (RFC 1928) — pure functions only.
//!
//! Only what a `-D` forward needs: the no-auth handshake, the CONNECT
//! command over TCP, and reply encoding. The IO glue lives in the parent
//! module; these functions are unit-tested against raw datagrams.

use std::fmt;

/// SOCKS protocol version implemented here.
pub const VERSION: u8 = 0x05;
/// No-authentication-required method.
pub const METHOD_NO_AUTH: u8 = 0x00;
/// Sent when the client offers no acceptable method.
pub const METHOD_NO_ACCEPTABLE: u8 = 0xFF;
/// CONNECT command; BIND/UDP ASSOCIATE are not supported.
pub const CMD_CONNECT: u8 = 0x01;
/// Reply: succeeded.
pub const REPLY_SUCCESS: u8 = 0x00;
/// Reply: general SOCKS server failure.
pub const REPLY_GENERAL_FAILURE: u8 = 0x01;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SocksError {
    /// First byte of a datagram is not 0x05.
    BadVersion,
    /// The client offered no no-auth method.
    NoAcceptableMethod,
    /// Command other than CONNECT.
    UnsupportedCommand,
    /// Unknown address type or malformed address.
    BadAddress,
    /// Datagram ended before the parser could finish.
    Truncated,
}

impl fmt::Display for SocksError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            SocksError::BadVersion => "bad_version",
            SocksError::NoAcceptableMethod => "no_acceptable_method",
            SocksError::UnsupportedCommand => "unsupported_command",
            SocksError::BadAddress => "bad_address",
            SocksError::Truncated => "truncated",
        };
        f.write_str(text)
    }
}

/// Destination address from a CONNECT request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SocksAddr {
    V4([u8; 4]),
    V6([u8; 16]),
    Domain(String),
}

impl SocksAddr {
    /// Host string as passed to the SSH `direct-tcpip` channel.
    pub fn to_host_string(&self) -> String {
        match self {
            SocksAddr::V4(octets) => octets
                .iter()
                .map(|o| o.to_string())
                .collect::<Vec<_>>()
                .join("."),
            SocksAddr::V6(octets) => octets
                .chunks(2)
                .map(|pair| format!("{:02x}{:02x}", pair[0], pair[1]))
                .collect::<Vec<_>>()
                .join(":"),
            SocksAddr::Domain(name) => name.clone(),
        }
    }
}

/// Parsed CONNECT request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocksRequest {
    pub addr: SocksAddr,
    pub port: u16,
}

/// Client greeting: `[VER, NMETHODS, METHODS...]`. Returns the methods.
pub fn parse_greeting(buf: &[u8]) -> Result<&[u8], SocksError> {
    if buf.len() < 2 {
        return Err(SocksError::Truncated);
    }
    if buf[0] != VERSION {
        return Err(SocksError::BadVersion);
    }
    let n = buf[1] as usize;
    if buf.len() < 2 + n {
        return Err(SocksError::Truncated);
    }
    Ok(&buf[2..2 + n])
}

/// Pick the client method: no-auth when offered, otherwise no-acceptable.
pub fn select_method(methods: &[u8]) -> u8 {
    if methods.contains(&METHOD_NO_AUTH) {
        METHOD_NO_AUTH
    } else {
        METHOD_NO_ACCEPTABLE
    }
}

/// IO-layer helper: selects the method straight from a greeting datagram.
/// Returns an owned `u8` so it can be used as a parsing callback.
pub fn select_method_from_greeting(buf: &[u8]) -> Result<u8, SocksError> {
    Ok(select_method(parse_greeting(buf)?))
}

/// Server method-selection reply.
pub fn method_reply(method: u8) -> [u8; 2] {
    [VERSION, method]
}

/// CONNECT request: `[VER, CMD, RSV, ATYP, ADDR..., PORT]`.
/// Parses as soon as the buffer holds the complete datagram.
pub fn parse_request(buf: &[u8]) -> Result<SocksRequest, SocksError> {
    if buf.is_empty() {
        return Err(SocksError::Truncated);
    }
    if buf[0] != VERSION {
        return Err(SocksError::BadVersion);
    }
    if buf.len() < 2 {
        return Err(SocksError::Truncated);
    }
    if buf[1] != CMD_CONNECT {
        return Err(SocksError::UnsupportedCommand);
    }
    if buf.len() < 4 {
        return Err(SocksError::Truncated);
    }
    let addr_len = match buf[3] {
        0x01 => 4,
        0x04 => 16,
        0x03 => {
            if buf.len() < 5 {
                return Err(SocksError::Truncated);
            }
            1 + buf[4] as usize
        }
        _ => return Err(SocksError::BadAddress),
    };
    let port_at = 4 + addr_len;
    if buf.len() < port_at + 2 {
        return Err(SocksError::Truncated);
    }
    let addr = match buf[3] {
        0x01 => SocksAddr::V4(buf[4..8].try_into().expect("4 bytes for IPv4")),
        0x04 => SocksAddr::V6(buf[4..20].try_into().expect("16 bytes for IPv6")),
        _ => {
            let len = buf[4] as usize;
            SocksAddr::Domain(String::from_utf8_lossy(&buf[5..5 + len]).into_owned())
        }
    };
    let port = u16::from_be_bytes([buf[port_at], buf[port_at + 1]]);
    Ok(SocksRequest { addr, port })
}

/// Server reply to CONNECT: `[VER, REP, RSV, 0, 0.0.0.0, 0]`.
pub fn connect_reply(status: u8) -> [u8; 10] {
    [
        VERSION, status, 0, 0, //
        0, 0, 0, 0, // BND.ADDR 0.0.0.0
        0, 0, // BND.PORT 0
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greeting_parses_methods_and_detects_problems() {
        assert_eq!(
            parse_greeting(&[0x05, 0x02, 0x00, 0x02]),
            Ok(&[0x00u8, 0x02][..])
        );
        assert_eq!(parse_greeting(&[0x05, 0x01, 0x00]), Ok(&[0x00u8][..]));
        // Wrong version, truncated, empty.
        assert_eq!(
            parse_greeting(&[0x04, 0x01, 0x00]),
            Err(SocksError::BadVersion)
        );
        assert_eq!(
            parse_greeting(&[0x05, 0x02, 0x00]),
            Err(SocksError::Truncated)
        );
        assert_eq!(parse_greeting(&[]), Err(SocksError::Truncated));
    }

    #[test]
    fn method_selection_prefers_no_auth() {
        assert_eq!(select_method(&[0x00]), METHOD_NO_AUTH);
        assert_eq!(select_method(&[0x02, 0x00, 0x01]), METHOD_NO_AUTH);
        assert_eq!(select_method(&[0x01, 0x02]), METHOD_NO_ACCEPTABLE);
        assert_eq!(select_method(&[]), METHOD_NO_ACCEPTABLE);
        assert_eq!(method_reply(METHOD_NO_AUTH), [0x05, 0x00]);
        assert_eq!(method_reply(METHOD_NO_ACCEPTABLE), [0x05, 0xFF]);
    }

    #[test]
    fn request_parses_ipv4_and_domain_targets() {
        let v4 = [0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0x1F, 0x90];
        assert_eq!(
            parse_request(&v4),
            Ok(SocksRequest {
                addr: SocksAddr::V4([127, 0, 0, 1]),
                port: 8080
            })
        );

        let domain = [
            0x05, 0x01, 0x00, 0x03, 0x0B, b'e', b'x', b'a', b'm', b'p', b'l', b'e', b'.', b'c',
            b'o', b'm', 0x00, 0x50,
        ];
        assert_eq!(
            parse_request(&domain),
            Ok(SocksRequest {
                addr: SocksAddr::Domain("example.com".into()),
                port: 80
            })
        );

        let v6 = [
            0x05, 0x01, 0x00, 0x04, 0x20, 0x01, 0x0D, 0xB8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01,
            0x00, 0x16,
        ];
        assert_eq!(
            parse_request(&v6),
            Ok(SocksRequest {
                addr: SocksAddr::V6([
                    0x20, 0x01, 0x0D, 0xB8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01
                ]),
                port: 22
            })
        );
    }

    #[test]
    fn request_rejects_bad_versions_commands_and_truncation() {
        let base = [0x05u8, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0x00, 0x50];
        // Wrong version.
        assert_eq!(
            parse_request(&[0x04, base[1], base[2], base[3]]),
            Err(SocksError::BadVersion)
        );
        // BIND instead of CONNECT.
        assert_eq!(
            parse_request(&[0x05, 0x02, 0x00, 0x01]),
            Err(SocksError::UnsupportedCommand)
        );
        // Unknown address type.
        assert_eq!(
            parse_request(&[0x05, 0x01, 0x00, 0x09]),
            Err(SocksError::BadAddress)
        );
        // Header only / address cut in half.
        assert_eq!(
            parse_request(&[0x05, 0x01, 0x00, 0x01]),
            Err(SocksError::Truncated)
        );
        assert_eq!(parse_request(&base[..9]), Err(SocksError::Truncated));
        assert_eq!(parse_request(&[]), Err(SocksError::Truncated));
    }

    #[test]
    fn addresses_render_as_host_strings() {
        assert_eq!(SocksAddr::V4([10, 0, 0, 1]).to_host_string(), "10.0.0.1");
        assert_eq!(
            SocksAddr::V6([0x20, 0x01, 0x0D, 0xB8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01])
                .to_host_string(),
            "2001:0db8:0000:0000:0000:0000:0000:0001"
        );
        assert_eq!(
            SocksAddr::Domain("example.com".into()).to_host_string(),
            "example.com"
        );
    }

    #[test]
    fn connect_reply_encodes_status() {
        assert_eq!(
            connect_reply(REPLY_SUCCESS),
            [0x05, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(
            connect_reply(REPLY_GENERAL_FAILURE),
            [0x05, 0x01, 0x00, 0x00, 0, 0, 0, 0, 0, 0]
        );
    }
}
