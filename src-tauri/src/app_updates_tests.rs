use super::*;
use tokio::net::TcpListener;

fn fixture(payload: &[u8]) -> Release {
    Release {
        id: 7,
        tag_name: "v0.10.0".into(),
        body: Some("## Changes\n- Full release notes".into()),
        draft: false,
        prerelease: false,
        assets: vec![Asset {
            id: 8,
            name: "proxytools-v0.10.0-windows-x64.exe".into(),
            size: payload.len() as u64,
            state: "uploaded".into(),
            digest: Some(format!("sha256:{:x}", Sha256::digest(payload))),
        }],
    }
}
#[test]
fn semantic_versions_and_stable_completed_windows_assets_are_required() {
    let bytes = b"MZ executable";
    let update = select_update(fixture(bytes), "0.9.0").unwrap().unwrap();
    assert_eq!(update.version, "0.10.0");
    assert_eq!(update.notes, "## Changes\n- Full release notes");
    assert!(select_update(fixture(bytes), "0.10.0").unwrap().is_none());
    assert!(select_update(fixture(bytes), "1.0.0").unwrap().is_none());
    let mut release = fixture(bytes);
    release.prerelease = true;
    assert!(select_update(release, "0.9.0").unwrap().is_none());
    let mut release = fixture(bytes);
    release.draft = true;
    assert!(select_update(release, "0.9.0").unwrap().is_none());
    let mut release = fixture(bytes);
    release.assets.clear();
    assert!(select_update(release, "0.9.0").unwrap().is_none());
    let mut release = fixture(bytes);
    release.assets[0].state = "new".into();
    assert!(select_update(release, "0.9.0").unwrap().is_none());
    let mut release = fixture(bytes);
    release.assets[0].name = "../../bad.exe".into();
    assert!(select_update(release, "0.9.0").unwrap().is_none());
    let mut release = fixture(bytes);
    release.assets[0].digest = None;
    assert!(select_update(release, "0.9.0").is_err());
}
#[test]
fn secrets_are_optional_profile_isolated_and_cannot_inject_headers() {
    assert!(validate_token("test_token").is_ok());
    for invalid in ["", "token\r\nInjected: bad", "a b", "ñ"] {
        assert!(validate_token(invalid).is_err());
    }
    assert_eq!(token_for(true, None).unwrap(), None);
    assert_eq!(
        token_for(true, Some("test_token".into())).unwrap(),
        Some("test_token".into())
    );
    #[cfg(not(windows))]
    assert_eq!(
        token_for(false, Some("ignored_mock_token".into())).unwrap(),
        None
    );
    let client = Client::new();
    let anonymous = request(&client, REPOSITORY, None, "application/vnd.github+json")
        .build()
        .unwrap();
    assert!(!anonymous.headers().contains_key(AUTHORIZATION));
    let authenticated = request(
        &client,
        REPOSITORY,
        Some("test_token"),
        "application/octet-stream",
    )
    .build()
    .unwrap();
    assert_eq!(authenticated.headers()[AUTHORIZATION], "Bearer test_token");
    assert!(!status_error(StatusCode::UNAUTHORIZED).contains("test_token"));
}
#[test]
fn redirects_only_accept_known_https_asset_hosts() {
    for url in [
        "https://release-assets.githubusercontent.com/asset",
        "https://objects.githubusercontent.com/asset",
    ] {
        assert!(allowed_download(&reqwest::Url::parse(url).unwrap()));
    }
    for url in [
        "http://release-assets.githubusercontent.com/a",
        "https://evil.example/a",
        "https://release-assets.githubusercontent.com.evil.example/a",
        "https://user:password@objects.githubusercontent.com/a",
        "https://objects.githubusercontent.com:8443/a",
    ] {
        assert!(!allowed_download(&reqwest::Url::parse(url).unwrap()));
    }
}
async fn response(payload: Vec<u8>, claimed_size: usize) -> Response {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        socket.read(&mut request).await.unwrap();
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {claimed_size}\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        for chunk in payload.chunks(8192) {
            socket.write_all(chunk).await.unwrap();
        }
    });
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap()
        .get(format!("http://{address}/asset"))
        .send()
        .await
        .unwrap()
}
#[tokio::test]
async fn downloads_stream_verify_and_publish_complete_executables_only() {
    let root = std::env::temp_dir().join(crate::backup_store::new_id("update-test"));
    tokio::fs::create_dir_all(&root).await.unwrap();
    let payload = [b"MZ".as_slice(), &vec![42; 2_000_000]].concat();
    let update = select_update(fixture(&payload), "0.9.0").unwrap().unwrap();
    let trace = DownloadTrace::new(&root);
    let task = save_download(
        response(payload.clone(), payload.len()).await,
        &root,
        &update,
        Some(&trace),
    );
    assert!(
        std::mem::size_of_val(&task) < 16 * 1024,
        "download task must remain small"
    );
    let path = task.await.unwrap();
    let stages = std::fs::read_to_string(root.join("updater.log")).unwrap();
    for stage in [
        "partial-file-created",
        "download-complete",
        "verification-started",
        "verification-complete",
        "publish-complete",
    ] {
        assert!(stages.contains(stage), "missing diagnostic stage: {stage}");
    }
    assert!(!stages.contains("127.0.0.1"));
    assert_eq!(tokio::fs::read(&path).await.unwrap(), payload);
    verify_file(&path, &update).await.unwrap();
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
    tokio::fs::write(&path, b"MZ tampered").await.unwrap();
    assert!(verify_file(&path, &update).await.is_err());
    tokio::fs::remove_dir_all(root).await.unwrap();
}
#[tokio::test]
async fn corrupt_and_interrupted_downloads_remove_partial_files() {
    let root = std::env::temp_dir().join(crate::backup_store::new_id("failed-update-test"));
    tokio::fs::create_dir_all(&root).await.unwrap();
    let original = b"MZ original executable";
    let update = select_update(fixture(original), "0.9.0").unwrap().unwrap();
    let corrupt = vec![b'X'; original.len()];
    assert!(save_download(
        response(corrupt, original.len()).await,
        &root,
        &update,
        None
    )
    .await
    .is_err());
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    assert!(save_download(
        response(b"MZ".to_vec(), original.len()).await,
        &root,
        &update,
        None,
    )
    .await
    .is_err());
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    tokio::fs::remove_dir_all(root).await.unwrap();
}

#[test]
fn verification_future_keeps_large_io_buffers_off_the_task_stack() {
    let update = select_update(fixture(b"MZ fixture"), "0.9.0")
        .unwrap()
        .unwrap();
    let future = verify_file(Path::new("unused-test-path"), &update);
    let bytes = std::mem::size_of_val(&future);
    assert!(
        bytes < 16 * 1024,
        "verification future occupies {bytes} bytes"
    );
}

#[test]
fn update_trace_records_only_stages_and_keeps_bounded_files() {
    let root = std::env::temp_dir().join(crate::backup_store::new_id("update-trace-test"));
    std::fs::create_dir_all(&root).unwrap();
    let trace = DownloadTrace::new(&root);
    trace.record("download-request-received", 0);
    trace.record("verification-started", 1234);
    let text = std::fs::read_to_string(root.join("updater.log")).unwrap();
    assert!(text.contains("stage=verification-started bytes=1234"));
    std::fs::write(root.join("updater.log"), vec![b'x'; 256 * 1024]).unwrap();
    trace.record("download-ready", 1234);
    assert!(std::fs::metadata(root.join("updater.log")).unwrap().len() < 1024);
    assert_eq!(
        std::fs::metadata(root.join("updater.previous.log"))
            .unwrap()
            .len(),
        256 * 1024
    );
    std::fs::remove_dir_all(root).unwrap();
}
