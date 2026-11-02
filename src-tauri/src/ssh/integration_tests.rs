//! Integration tests against a real SSH server.
//!
//! They exercise the full protocol stack (russh + russh-sftp against OpenSSH)
//! exactly like a production connection. The suite is environment-gated: when
//! `QUARTZSSH_TEST_SSH_*` variables are absent (local `cargo test`, most CI
//! runs) the tests print a skip notice and succeed. The dedicated CI job
//! (`integration.yml`) starts an OpenSSH container and provides the variables.

use std::path::PathBuf;
use std::sync::Arc;

use russh::client;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};
use russh::ChannelMsg;
use russh_sftp::protocol::OpenFlags;
use tokio::io::AsyncWriteExt;

/// The test server accepts every presented host key: the container is
/// ephemeral and the connection never leaves the CI runner.
struct AcceptAll;

impl client::Handler for AcceptAll {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

struct TestServer {
    host: String,
    port: u16,
    user: String,
    key: PathBuf,
}

fn test_server() -> Option<TestServer> {
    let host = std::env::var("QUARTZSSH_TEST_SSH_HOST").ok()?;
    let port = std::env::var("QUARTZSSH_TEST_SSH_PORT")
        .ok()?
        .parse()
        .ok()?;
    let user = std::env::var("QUARTZSSH_TEST_SSH_USER").ok()?;
    let key = PathBuf::from(std::env::var("QUARTZSSH_TEST_SSH_KEY").ok()?);
    Some(TestServer {
        host,
        port,
        user,
        key,
    })
}

async fn connect_key_auth(server: &TestServer) -> client::Handle<AcceptAll> {
    let key = crate::ssh::load_private_key(server.key.to_str().expect("utf8 key path"), None)
        .expect("test key must load");
    let config = client::Config {
        nodelay: true,
        ..Default::default()
    };
    let mut handle = client::connect(
        Arc::new(config),
        (server.host.as_str(), server.port),
        AcceptAll,
    )
    .await
    .expect("connection to the test server");
    let accepted = handle
        .authenticate_publickey(
            server.user.as_str(),
            PrivateKeyWithHashAlg::new(Arc::new(key), Some(HashAlg::Sha256)),
        )
        .await
        .expect("auth exchange");
    assert!(accepted.success(), "public key auth must succeed");
    handle
}

#[tokio::test]
async fn exec_roundtrip_on_real_server() {
    let Some(server) = test_server() else {
        eprintln!("QUARTZSSH_TEST_SSH_* not set — integration suite skipped");
        return;
    };
    let mut handle = connect_key_auth(&server).await;

    let mut channel = handle.channel_open_session().await.expect("channel");
    channel
        .exec(true, "echo quartzssh-integration-ok")
        .await
        .expect("exec");
    let mut out = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => out.extend_from_slice(data),
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    assert_eq!(
        String::from_utf8_lossy(&out).trim(),
        "quartzssh-integration-ok"
    );
}

#[tokio::test]
async fn sftp_write_read_cleanup_roundtrip() {
    let Some(server) = test_server() else {
        eprintln!("QUARTZSSH_TEST_SSH_* not set — integration suite skipped");
        return;
    };
    let handle = connect_key_auth(&server).await;

    let channel = handle.channel_open_session().await.expect("channel");
    channel
        .request_subsystem(true, "sftp")
        .await
        .expect("sftp subsystem");
    let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
        .await
        .expect("sftp init");

    let dir = "/tmp/quartzssh-integration";
    let path = format!("{dir}/hello.txt");
    sftp.create_dir(dir).await.expect("mkdir /tmp subdirectory");

    // SftpSession::write opens with WRITE only — no CREATE/TRUNCATE — so a
    // brand-new file must be created explicitly (russh-sftp 3.0.x behavior).
    let mut file = sftp
        .open_with_flags(
            &path,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        )
        .await
        .expect("create file");
    file.write_all(b"hello from quartzssh")
        .await
        .expect("write");
    file.close().await.expect("close file");

    let data = sftp.read(&path).await.expect("read");
    assert_eq!(data, b"hello from quartzssh");

    let meta = sftp.metadata(&path).await.expect("stat");
    assert_eq!(meta.size, Some(20), "size must match the written payload");

    sftp.remove_file(&path).await.expect("remove file");
    sftp.remove_dir(dir).await.expect("remove dir");
    sftp.close().await.expect("sftp close");
}

#[tokio::test]
async fn rejected_credentials_do_not_authenticate() {
    let Some(server) = test_server() else {
        eprintln!("QUARTZSSH_TEST_SSH_* not set — integration suite skipped");
        return;
    };
    let key = crate::ssh::load_private_key(server.key.to_str().expect("utf8 key path"), None)
        .expect("test key must load");
    let config = client::Config::default();
    let mut handle = client::connect(
        Arc::new(config),
        (server.host.as_str(), server.port),
        AcceptAll,
    )
    .await
    .expect("transport must succeed even with bad credentials");
    // A wrong username must not authenticate; the transport itself stays alive.
    let rejected = handle
        .authenticate_publickey(
            "definitely-not-a-user",
            PrivateKeyWithHashAlg::new(Arc::new(key), Some(HashAlg::Sha256)),
        )
        .await
        .expect("auth exchange");
    assert!(!rejected.success(), "wrong user must not authenticate");
}
