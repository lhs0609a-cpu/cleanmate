// 클린메이트 데스크톱 셸 (Tauri v2)
//
// 이 Rust 층은 얇다. 무거운 판단(분류·격리·질문)은 이미 검증된 TS 엔진이 하고,
// 여기는 창을 띄우고, 권한 있는 작업(자동 업데이트 설치)만 담당한다.
// engine.ts가 질문 '선정'만 하고 실행은 안 하는 것과 같은 분리 철학이다.
//
// 명령줄 인자:
//   --minimized  부팅 자동시작 시. 창을 띄우지 않고 트레이로 조용히 상주(V3/알약식).
//   --updated    자동 업데이트 재설치 직후. "업데이트됨" 알림용.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

/// 다운로드한 이노셋업 설치파일을 무인 실행 → 조용히 재설치 → 앱 재시작.
/// 인자는 updater.ts의 silentInstallArgs()와 반드시 일치한다.
#[tauri::command]
fn apply_update(installer_path: String) -> Result<(), String> {
    Command::new(&installer_path)
        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        .spawn()
        .map_err(|e| format!("업데이트 설치를 시작하지 못했어요: {e}"))?;

    // 이노셋업이 실행 중인 앱을 닫고 재설치한 뒤 --updated 로 재시작한다.
    // 여기서 우리가 먼저 빠져줘야 설치가 파일을 덮어쓸 수 있다.
    std::process::exit(0);
}

/// 업데이트 설치파일을 받아 임시 폴더에 저장하고 경로를 돌려준다.
#[tauri::command]
async fn download_update(url: String) -> Result<String, String> {
    let bytes = reqwest::get(&url)
        .await
        .map_err(|e| format!("다운로드 실패: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("다운로드 실패: {e}"))?;

    let mut path = std::env::temp_dir();
    path.push("CleanMate-Update-Setup.exe");
    std::fs::write(&path, &bytes).map_err(|e| format!("저장 실패: {e}"))?;

    Ok(path.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![apply_update, download_update])
        .run(tauri::generate_context!())
        .expect("클린메이트 실행 중 오류");
}
