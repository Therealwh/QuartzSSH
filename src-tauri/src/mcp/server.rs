//! Streamable HTTP transport for the MCP bridge, without any MCP crate:
//! a Tokio TCP listener on 127.0.0.1 serving `POST /mcp` with JSON-RPC 2.0
//! responses. Everything else (GET, other paths, other methods) is 405.

use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use super::http::{self, HttpRequest};
use super::tools::{self, ToolCtx};
use super::McpState;
use crate::config::SettingsStore;

const JSON_CT: &str = "application/json";
/// Protocol version this bridge speaks (Streamable HTTP introduced here).
const PROTOCOL_VERSION: &str = "2025-03-26";
/// Per-read deadline: a client that stops talking mid-request is dropped.
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Accept loop; exits when the shutdown oneshot fires (sender dropped or
/// `()` sent by `McpState::stop`).
pub async fn serve(
    listener: TcpListener,
    app: AppHandle,
    state: Arc<McpState>,
    token: String,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _peer)) => {
                    let app = app.clone();
                    let state = state.clone();
                    let token = token.clone();
                    tokio::spawn(handle_connection(stream, app, state, token));
                }
                Err(e) => {
                    log::warn!("mcp: accept failed, stopping: {e}");
                    break;
                }
            },
        }
    }
    log::info!("mcp: server stopped");
}

async fn handle_connection(
    mut stream: TcpStream,
    app: AppHandle,
    state: Arc<McpState>,
    token: String,
) {
    // Read until the minimal parser has a complete request.
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let request = loop {
        match http::parse_request(&buf) {
            Ok(Some(req)) => break req,
            Ok(None) => {}
            Err(http::ParseError::TooLarge) => {
                let _ = stream
                    .write_all(&http::build_response(
                        413,
                        Some(JSON_CT),
                        &error_body("payload too large"),
                    ))
                    .await;
                return;
            }
            Err(_) => {
                let _ = stream
                    .write_all(&http::build_response(
                        400,
                        Some(JSON_CT),
                        &error_body("malformed request"),
                    ))
                    .await;
                return;
            }
        }
        match tokio::time::timeout(IO_TIMEOUT, stream.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => return,
            Ok(Ok(n)) => buf.extend_from_slice(&chunk[..n]),
        }
    };

    let (status, content_type, body) = route(&app, &state, &token, &request).await;
    let _ = stream
        .write_all(&http::build_response(status, content_type, &body))
        .await;
    let _ = stream.shutdown().await;
}

type Response = (u16, Option<&'static str>, Vec<u8>);

async fn route(app: &AppHandle, state: &Arc<McpState>, token: &str, req: &HttpRequest) -> Response {
    // DNS-rebinding defense first: a foreign Host header never proceeds.
    if !http::is_host_allowed(http::header(req, "host").unwrap_or("")) {
        return (403, Some(JSON_CT), error_body("forbidden: loopback only"));
    }
    // The transport only knows POST /mcp; everything else is 405.
    if req.method != "POST" || req.path != "/mcp" {
        return (
            405,
            Some(JSON_CT),
            error_body("method not allowed: use POST /mcp"),
        );
    }
    // Bearer token issued by mcp_start.
    if !http::check_bearer(http::header(req, "authorization"), token) {
        return (
            401,
            Some(JSON_CT),
            error_body("unauthorized: missing or invalid bearer token"),
        );
    }

    let parsed: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => {
            let body = rpc_error(Value::Null, -32700, "parse error");
            return (200, Some(JSON_CT), body);
        }
    };
    // Batches are not supported by this minimal bridge.
    if !parsed.is_object() {
        let body = rpc_error(
            Value::Null,
            -32600,
            "invalid request: expected a single object",
        );
        return (200, Some(JSON_CT), body);
    }

    let id = parsed.get("id").cloned().unwrap_or(Value::Null);
    let method = parsed.get("method").and_then(Value::as_str).unwrap_or("");
    if id.is_null() {
        // A notification (no id), e.g. notifications/initialized: acknowledge
        // without a body per the JSON-RPC transport conventions.
        return (202, None, Vec::new());
    }

    let params = parsed.get("params");
    let body = match method {
        "initialize" => rpc_result(id, initialize_result(app, params)),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, tools_list_value()),
        "tools/call" => rpc_result(id, tools_call(app, state, params).await),
        other => rpc_error(id, -32601, &format!("method not found: {other}")),
    };
    (200, Some(JSON_CT), body)
}

fn error_body(message: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({ "error": message })).unwrap_or_default()
}

fn rpc_result(id: Value, result: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({ "jsonrpc": "2.0", "id": id, "result": result })).unwrap_or_default()
}

fn rpc_error(id: Value, code: i64, message: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    }))
    .unwrap_or_default()
}

fn initialize_result(app: &AppHandle, params: Option<&Value>) -> Value {
    // Echo the client's requested version when it asks for one.
    let requested = params
        .and_then(|p| p.get("protocolVersion"))
        .and_then(Value::as_str)
        .unwrap_or(PROTOCOL_VERSION);
    json!({
        "protocolVersion": requested,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": {
            "name": "quartzssh",
            "version": app.package_info().version.to_string()
        },
        "instructions": "QuartzSSH bridge: operate SSH/SFTP sessions that are \
            already open in the desktop app. Hosts are limited to the user's \
            allowlist; destructive actions require confirmation in the app.",
    })
}

fn tools_list_value() -> Value {
    let list: Vec<Value> = tools::tool_definitions()
        .iter()
        .map(|d| {
            json!({
                "name": d.name,
                "description": d.description,
                "inputSchema": d.input_schema,
            })
        })
        .collect();
    json!({ "tools": list })
}

async fn tools_call(app: &AppHandle, state: &Arc<McpState>, params: Option<&Value>) -> Value {
    let params = params.cloned().unwrap_or(Value::Null);
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let args = params.get("arguments").cloned().unwrap_or(json!({}));
    let host = args
        .get("host")
        .and_then(Value::as_str)
        .unwrap_or("-")
        .to_string();

    let settings = app.state::<SettingsStore>().get().mcp;
    let ctx = ToolCtx {
        app,
        state,
        settings,
    };
    let (status, text) = match tools::call_tool(&ctx, &name, &args).await {
        Ok(text) => ("ok", text),
        Err(err) => ("error", err),
    };
    state.audit_push(&name, &host, &tools::summarize_args(&args), status);

    json!({
        "content": [ { "type": "text", "text": text } ],
        "isError": status == "error",
    })
}
