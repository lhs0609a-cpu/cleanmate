// 테라클린 데스크톱 셸 (Tauri v2)
//
// 이 Rust 층은 얇다. 무거운 판단(분류·격리·질문·프로브)은 이미 검증된 TS 엔진이
// teraclean-engine.exe(사이드카)로 하고, 여기는 그걸 호출하고 창을 띄우고
// 권한 있는 작업(자동 업데이트)만 담당한다. (docs/배포-아키텍처.md §2)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sha2::{Digest, Sha256};
use std::process::Command as StdCommand;

/// 파일을 읽어 SHA-256을 16진수 소문자로 돌려준다.
/// 통째로 메모리에 올리지 않고 조금씩 읽는다 — 설치파일은 수십 MB다.
fn file_sha256(path: &std::path::Path) -> Result<String, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| format!("파일을 열지 못했어요: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("파일을 읽지 못했어요: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// download_update가 UI에 돌려주는 것 — 저장 경로와 그 파일의 SHA-256.
#[derive(serde::Serialize)]
struct DownloadedUpdate {
    path: String,
    sha256: String,
}

/// 다운로드한 이노셋업 설치파일을 무인 실행 → 조용히 재설치 → 앱 재시작.
/// 인자는 updater.ts의 silentInstallArgs()와 반드시 일치한다.
///
/// ★ 실행 직전에 해시를 다시 계산해 대조한다. UI(TS) 층에서 이미 한 번
///   검증하지만, 그 층이 우회되거나 검증 후 파일이 바뀌었을(TOCTOU) 경우까지
///   막아야 한다 — 여기가 임의 코드 실행의 마지막 관문이다.
///   불일치면 실행하지 않고 파일을 지운다.
#[tauri::command]
fn apply_update(installer_path: String, expected_sha256: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&installer_path);

    let expected = expected_sha256.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        let _ = std::fs::remove_file(&path);
        return Err("업데이트 서명이 없거나 형식이 잘못돼 설치를 멈췄어요".into());
    }

    let actual = match file_sha256(&path) {
        Ok(h) => h,
        Err(e) => {
            let _ = std::fs::remove_file(&path);
            return Err(e);
        }
    };
    if actual != expected {
        // 받은 파일이 우리가 만든 게 아니다. 실행하지 않고 흔적을 지운다.
        let _ = std::fs::remove_file(&path);
        return Err("받은 파일이 릴리스에 게시된 것과 달라요 — 설치를 멈추고 파일을 지웠어요".into());
    }

    StdCommand::new(&installer_path)
        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        .spawn()
        .map_err(|e| format!("업데이트 설치를 시작하지 못했어요: {e}"))?;
    std::process::exit(0);
}

/// 업데이트 설치파일을 받아 임시 폴더에 저장하고, 경로와 SHA-256을 돌려준다.
/// 해시 대조는 부르는 쪽(updater.ts의 verifyIntegrity)이 한다.
#[tauri::command]
async fn download_update(url: String) -> Result<DownloadedUpdate, String> {
    // https 외의 스킴은 받지 않는다 — 평문이나 로컬 경로로 유도되는 걸 막는다.
    if !url.starts_with("https://") {
        return Err("업데이트 주소가 https가 아니라 받지 않았어요".into());
    }
    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| format!("다운로드 실패: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("다운로드 실패: {e}"))?;
    let mut path = std::env::temp_dir();
    path.push("TeraClean-Update-Setup.exe");
    std::fs::write(&path, &bytes).map_err(|e| format!("저장 실패: {e}"))?;
    let sha256 = file_sha256(&path)?;
    Ok(DownloadedUpdate {
        path: path.to_string_lossy().into_owned(),
        sha256,
    })
}

/// 설치 제거 — 프로그램이 등록해 둔 **정식 언인스톨러**를 띄운다.
///
/// ★ 우리가 프로그램 파일을 지우는 경로는 어디에도 없다. 폴더를 직접 지우면
///   레지스트리·서비스·셸 확장이 남아 시스템이 지저분해지고 재설치도 막힌다.
///   그래서 레지스트리의 UninstallString을 그대로 실행하고, 그 다음은
///   제조사의 제거 마법사와 사용자에게 맡긴다.
///
/// 격리로 되돌릴 수 없는 유일한 동작이라, UI가 하나씩 확인을 받은 뒤에만 부른다.
/// (일괄 제거 API를 만들지 않는 이유 — src/probes/programs.ts 머리말)
#[tauri::command]
fn run_uninstaller(command: String) -> Result<(), String> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return Err("제거 명령이 비어 있어요".into());
    }
    // 레지스트리에서 읽은 값만 들어온다는 전제지만, 실행 파일을 가리키는지 최소한 확인한다.
    let lower = cmd.to_lowercase();
    if !(lower.contains(".exe") || lower.contains("msiexec")) {
        return Err("실행 파일을 가리키지 않는 제거 명령이라 실행하지 않았어요".into());
    }
    // UninstallString은 따옴표·인자가 섞인 원시 명령줄이라 cmd에 그대로 넘긴다.
    StdCommand::new("cmd")
        .args(["/C", cmd])
        .spawn()
        .map_err(|e| format!("제거 프로그램을 실행하지 못했어요: {e}"))?;
    Ok(())
}

/// ★ 엔진 사이드카 호출 — UI와 검증된 TS 엔진을 잇는 유일한 통로.
/// 명령+인자를 주면 teraclean-engine.exe가 JSON을 돌려준다(engine-cli.ts 규약).
/// 엔진 exe는 앱 exe 바로 옆에 있다(이노셋업이 함께 설치).
#[tauri::command]
async fn run_engine(command: String, args: Vec<String>) -> Result<serde_json::Value, String> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("실행 경로를 찾을 수 없어요")?
        .to_path_buf();
    let engine = exe_dir.join("teraclean-engine.exe");

    let output = tokio::process::Command::new(&engine)
        .arg(&command)
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("엔진을 실행하지 못했어요: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|e| format!("엔진 응답을 읽지 못했어요: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            apply_update,
            download_update,
            run_engine,
            run_uninstaller
        ])
        .run(tauri::generate_context!())
        .expect("테라클린 실행 중 오류");
}
