//! Minimal HTTP/1.1 plumbing for the embedded MCP server.
//!
//! The MCP transport is plain request/response JSON over HTTP POST — no SSE,
//! no chunked encoding, no keep-alive (`Connection: close` everywhere). Only
//! as much of HTTP as a Streamable HTTP MCP client needs is implemented, as
//! pure functions so it can be tested without sockets.

/// Maximum size of the request head (request line + headers).
const MAX_HEAD: usize = 16 * 1024;
/// Maximum size of a JSON-RPC body.
const MAX_BODY: usize = 4 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    /// Header names are lowercased.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, PartialEq)]
pub enum ParseError {
    /// Head or body exceeds the limits.
    TooLarge,
    /// Request line or headers cannot be parsed.
    Malformed,
}

/// Incremental request parser: feed the accumulated read buffer, get either
/// a complete request, "need more data" (`Ok(None)`), or an error.
pub fn parse_request(buf: &[u8]) -> Result<Option<HttpRequest>, ParseError> {
    let head_end = match find_head_end(buf) {
        Some(i) => i,
        None => {
            if buf.len() > MAX_HEAD {
                return Err(ParseError::TooLarge);
            }
            return Ok(None);
        }
    };
    if head_end > MAX_HEAD {
        return Err(ParseError::TooLarge);
    }
    let head = std::str::from_utf8(&buf[..head_end]).map_err(|_| ParseError::Malformed)?;
    let mut lines = head.split("\r\n");
    let request_line = lines.next().ok_or(ParseError::Malformed)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or(ParseError::Malformed)?.to_string();
    let path = parts.next().ok_or(ParseError::Malformed)?.to_string();
    if parts.next().is_none() {
        return Err(ParseError::Malformed);
    }

    let mut headers = Vec::new();
    let mut content_length: usize = 0;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once(':').ok_or(ParseError::Malformed)?;
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        if name == "content-length" {
            content_length = value.parse().map_err(|_| ParseError::Malformed)?;
        }
        headers.push((name, value));
    }

    let body_start = head_end + 4;
    if content_length > MAX_BODY {
        return Err(ParseError::TooLarge);
    }
    if buf.len() < body_start + content_length {
        return Ok(None);
    }
    Ok(Some(HttpRequest {
        method,
        path,
        headers,
        body: buf[body_start..body_start + content_length].to_vec(),
    }))
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Case-insensitive header lookup.
pub fn header<'a>(req: &'a HttpRequest, name: &str) -> Option<&'a str> {
    let name = name.to_ascii_lowercase();
    req.headers
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, v)| v.as_str())
}

/// DNS-rebinding defense: only loopback hosts are accepted. The `Host`
/// header must be exactly `localhost`, `127.0.0.1` or `[::1]` (port suffix
/// allowed, case-insensitive). Anything else — including subdomains like
/// `localhost.evil.com` — is rejected.
pub fn is_host_allowed(host: &str) -> bool {
    let host = host.trim();
    if host.is_empty() {
        return false;
    }
    let name = if let Some(rest) = host.strip_prefix('[') {
        match rest.find(']') {
            Some(i) => &rest[..i],
            None => return false,
        }
    } else if host.matches(':').count() == 1 {
        host.split(':').next().unwrap_or("")
    } else {
        // Bare IPv6 without brackets (never valid in a Host header) — accept
        // only the exact loopback form.
        host
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1"
    )
}

/// Bearer-token check. Comparison is constant-time so request timing does
/// not leak the token byte by byte (the length difference is visible, which
/// is acceptable for a randomly generated fixed-length token).
pub fn check_bearer(header_value: Option<&str>, token: &str) -> bool {
    let value = match header_value {
        Some(v) => v.trim(),
        None => return false,
    };
    let presented = match value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
    {
        Some(rest) => rest.trim(),
        None => return false,
    };
    constant_time_eq(presented, token)
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

pub fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        _ => "",
    }
}

pub fn build_response(status: u16, content_type: Option<&str>, body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 160);
    out.extend_from_slice(format!("HTTP/1.1 {} {}\r\n", status, status_text(status)).as_bytes());
    if let Some(ct) = content_type {
        out.extend_from_slice(format!("Content-Type: {ct}\r\n").as_bytes());
    }
    out.extend_from_slice(format!("Content-Length: {}\r\n", body.len()).as_bytes());
    out.extend_from_slice(b"Connection: close\r\n\r\n");
    out.extend_from_slice(body);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_request(method: &str, path: &str, headers: &str, body: &str) -> Vec<u8> {
        format!("{method} {path} HTTP/1.1\r\n{headers}\r\n\r\n{body}").into_bytes()
    }

    #[test]
    fn parses_complete_request_and_reports_incomplete() {
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let bytes = full_request(
            "POST",
            "/mcp",
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\nHost: 127.0.0.1:47215",
                body.len()
            ),
            body,
        );
        let req = parse_request(&bytes).unwrap().expect("complete");
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/mcp");
        assert_eq!(header(&req, "host"), Some("127.0.0.1:47215"));
        assert_eq!(header(&req, "HOST"), Some("127.0.0.1:47215"));
        assert_eq!(req.body, body.as_bytes());

        // Body not fully arrived yet.
        let truncated = &bytes[..bytes.len() - 5];
        assert_eq!(parse_request(truncated), Ok(None));
    }

    #[test]
    fn bearer_check_accepts_valid_rejects_invalid_and_missing() {
        let token = "abcdefghijklmnopqrstuvwxyz0123456789-_x";
        assert!(check_bearer(Some(&format!("Bearer {token}")), token));
        assert!(check_bearer(Some(&format!("bearer  {token} ")), token));
        // Wrong token, wrong scheme, garbage, missing header.
        assert!(!check_bearer(Some(&format!("Bearer {token}x")), token));
        assert!(!check_bearer(Some("Bearer "), token));
        assert!(!check_bearer(Some(&format!("Basic {token}")), token));
        assert!(!check_bearer(None, token));
    }

    #[test]
    fn host_header_allows_only_loopback() {
        for ok in [
            "localhost",
            "localhost:47215",
            "127.0.0.1",
            "127.0.0.1:47215",
            "[::1]",
            "[::1]:80",
        ] {
            assert!(is_host_allowed(ok), "{ok} must be allowed");
        }
        for bad in [
            "",
            "evil.com",
            "evil.com:80",
            "localhost.evil.com",
            "localhost.evil.com:80",
            "127.0.0.1.evil.com",
            "0.0.0.0",
            "[fe80::1]:80",
            "localhos",
        ] {
            assert!(!is_host_allowed(bad), "{bad} must be rejected");
        }
    }

    #[test]
    fn response_has_status_length_and_close() {
        let res = build_response(401, Some("application/json"), b"{}");
        let text = String::from_utf8(res).unwrap();
        assert!(text.starts_with("HTTP/1.1 401 Unauthorized\r\n"));
        assert!(text.contains("Content-Type: application/json\r\n"));
        assert!(text.contains("Content-Length: 2\r\n"));
        assert!(text.ends_with("Connection: close\r\n\r\n{}"));
    }
}
