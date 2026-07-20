// 클린메이트 데스크톱 셸 (Tauri v2)
//
// 이 Rust 층은 얇다. 무거운 판단(분류·격리·질문·프로브)은 이미 검증된 TS 엔진이
// cleanmate-engine.exe(사이드카)로 하고, 여기는 그걸 호출하고 창을 띄우고
// 권한 있는 작업(자동 업데이트)만 담당한다. (docs/배포-아키텍처.md §2)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command as StdCommand;

/// 다운로드한 이노셋업 설치파일을 무인 실행 → 조용히 재설치 → 앱 재시작.
/// 인자는 updater.ts의 silentInstallArgs()와 반드시 일치한다.
#[tauri::command]
fn apply_update(installer_path: String) -> Result<(), String> {
    StdCommand::new(&installer_path)
        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
        .spawn()
        .map_err(|e| format!("업데이트 설치를 시작하지 못했어요: {e}"))?;
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

/// ★ 엔진 사이드카 호출 — UI와 검증된 TS 엔진을 잇는 유일한 통로.
/// 명령+인자를 주면 cleanmate-engine.exe가 JSON을 돌려준다(engine-cli.ts 규약).
/// 엔진 exe는 앱 exe 바로 옆에 있다(이노셋업이 함께 설치).
#[tauri::command]
async fn run_engine(command: String, args: Vec<String>) -> Result<serde_json::Value, String> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("실행 경로를 찾을 수 없어요")?
        .to_path_buf();
    let engine = exe_dir.join("cleanmate-engine.exe");

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
            run_engine
        ])
        .run(tauri::generate_context!())
        .expect("클린메이트 실행 중 오류");
}
