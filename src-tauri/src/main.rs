// 테라클린 데스크톱 셸 (Tauri v2)
//
// 이 Rust 층은 얇다. 무거운 판단(분류·격리·질문·프로브)은 이미 검증된 TS 엔진이
// teraclean-engine.exe(사이드카)로 하고, 여기는 그걸 호출하고 창을 띄우고
// 권한 있는 작업(자동 업데이트)만 담당한다. (docs/배포-아키텍처.md §2)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sha2::{Digest, Sha256};
use std::os::windows::process::CommandExt;
use std::process::Command as StdCommand;

/// 자식 프로세스에 콘솔 창을 붙이지 않는다 (winbase.h CREATE_NO_WINDOW).
/// 값 하나 때문에 windows-sys를 끌어오지 않는다.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

/* ── 도는 엔진의 취소 통로 ──────────────────────────────────
   긴 스캔을 세우려면 이미 떠 있는 자식에게 말을 걸어야 한다. stdout은 결과,
   stderr는 진행 상황이라 남은 통로는 stdin뿐이다. 여기 그 손잡이를 맡아둔다.

   ★ 왜 프로세스를 죽이지 않나: 죽이면 여태 훑은 결과가 함께 사라진다.
     "여기까지만 보기"를 누른 사람에게 빈 화면을 주면 취소가 벌이 된다.
     엔진은 신호를 받으면 스스로 멈추고 그 시점까지의 목록을 정상 결과로 낸다. */
static JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, tokio::process::ChildStdin>>,
> = std::sync::OnceLock::new();

fn jobs() -> &'static std::sync::Mutex<std::collections::HashMap<String, tokio::process::ChildStdin>>
{
    JOBS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// 도는 엔진을 세운다. 없는 일감이면 조용히 지나간다 —
/// 이미 끝난 스캔을 세우려 한 것뿐이고, 그건 실패가 아니다.
#[tauri::command]
async fn cancel_engine(job: String) -> Result<bool, String> {
    use tokio::io::AsyncWriteExt;

    // ★ 락을 들고 await하지 않는다. 손잡이를 꺼내 온 뒤에 쓴다.
    //   (한 번 세우면 그 일감에 더 할 말이 없으므로 도로 넣지 않는다)
    let taken = { jobs().lock().map_err(|_| "취소 장부를 열지 못했어요")?.remove(&job) };
    match taken {
        Some(mut stdin) => {
            stdin
                .write_all(b"cancel\n")
                .await
                .map_err(|e| format!("멈추라고 전하지 못했어요: {e}"))?;
            let _ = stdin.flush().await;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 창을 다시 꺼내 온다. 트레이 메뉴·두 번째 실행 둘 다 여기로 온다.
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

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

/// 업데이트 장부(latest.json)를 받아 본문을 그대로 돌려준다.
///
/// ★ 왜 Rust가 받나 (실물에서 터진 버그):
///   웹뷰에서 릴리스 자산을 fetch하면 **CORS에 막힌다.** GitHub API(api.github.com)는
///   허용 헤더를 주지만, 릴리스 자산 다운로드(release-assets.githubusercontent.com)는
///   주지 않는다. 그래서 서명을 못 읽고 → 검증 불가 → fail closed로 거절됐다.
///   사용자에겐 "릴리스에 서명이 없어요"로 보였지만 서명은 멀쩡히 있었다.
///   (Node로 검증할 땐 CORS를 안 따지므로 통과해서, 실물에서만 드러났다.)
///
///   Rust에는 CORS가 없다. 대신 아무 주소나 받지 않도록 호스트를 제한한다.
#[tauri::command]
async fn fetch_update_manifest(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("업데이트 장부 주소가 https가 아니라 받지 않았어요".into());
    }
    // 우리 릴리스가 사는 곳만 허용한다 — 임의 주소를 받아오는 통로를 만들지 않는다.
    let allowed = ["github.com/", "githubusercontent.com/"];
    if !allowed.iter().any(|h| url.contains(h)) {
        return Err("허용되지 않은 주소예요".into());
    }
    reqwest::get(&url)
        .await
        .map_err(|e| format!("장부를 받지 못했어요: {e}"))?
        .text()
        .await
        .map_err(|e| format!("장부를 읽지 못했어요: {e}"))
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

/// 원시 명령줄을 (실행 파일, 나머지 인자 문자열)로 가른다.
///
/// UninstallString은 `"C:\Program Files\Foo\unins000.exe" /SILENT` 같은 **원시 명령줄**이라
/// 그냥 넘길 수 없다. 예전엔 `cmd /C`에 통째로 던졌는데, 그러면 (1) 검은 창이 뜨고
/// (2) cmd의 악명 높은 따옴표 처리에 명령이 망가질 수 있고 (3) 남의 문자열이
/// **셸을 통과한다.** 이 앱은 밖에서 온 문자열을 셸에 넘기지 않는다.
/// 그래서 우리가 직접 가르고 실행 파일을 바로 부른다.
///
/// 따옴표가 없는데 경로에 공백이 있는 경우(`C:\Program Files\...`)는 윈도우의
/// CreateProcess와 같은 방식으로 앞에서부터 잘라보며 실제 파일을 찾는다.
fn split_command_line(command: &str) -> (String, String) {
    let cmd = command.trim();

    if let Some(rest) = cmd.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return (
                rest[..end].to_string(),
                rest[end + 1..].trim_start().to_string(),
            );
        }
    }

    for (i, _) in cmd.match_indices(' ') {
        if std::path::Path::new(&cmd[..i]).is_file() {
            return (cmd[..i].to_string(), cmd[i + 1..].trim_start().to_string());
        }
    }

    match cmd.find(' ') {
        // 파일로 확인되진 않았지만 msiexec처럼 PATH에서 찾히는 경우가 있다 — OS에 맡긴다.
        Some(i) => (cmd[..i].to_string(), cmd[i + 1..].trim_start().to_string()),
        None => (cmd.to_string(), String::new()),
    }
}

/// run_uninstaller가 UI에 돌려주는 것.
#[derive(serde::Serialize)]
struct UninstallOutcome {
    /// 끝까지 기다렸나. 마법사를 띄운 경우는 false — 그때는 우리가 결과를 모른다.
    waited: bool,
    /// 언인스톨러의 종료 코드. **성공의 증거로 쓰지 않는다**(아래 머리말 참고).
    code: Option<i32>,
}

/// 설치 제거 — 프로그램이 등록해 둔 **정식 언인스톨러**를 호출한다.
///
/// ★ 우리가 프로그램 파일을 지우는 경로는 어디에도 없다. 폴더를 직접 지우면
///   레지스트리·서비스·셸 확장이 남아 시스템이 지저분해지고 재설치도 막힌다.
///   그래서 레지스트리의 제거 명령을 그대로 실행한다.
///
/// `silent`가 참이면 **앱 안에서 끝낸다** — 창 없이 실행하고 끝날 때까지 기다린다.
/// 이때 넘어오는 명령은 제조사가 등록한 QuietUninstallString이거나 MSI 규격 명령뿐이다
/// (src/probes/programs.ts의 silentUninstallCommand). 우리가 무인 스위치를 지어내지 않는다.
/// 거짓이면 예전처럼 제조사 마법사를 띄우고 곧바로 돌아온다.
///
/// ★ 종료 코드는 성공의 증거가 아니다. 이노셋업 언인스톨러는 자기를 임시 폴더로
///   복사한 뒤 0을 반환하고 빠진다. 그래서 여기서는 판정하지 않고, 화면이
///   엔진의 `program-installed`로 레지스트리에 다시 물어본 뒤에 결론을 낸다.
///
/// 격리로 되돌릴 수 없는 유일한 동작이라, UI가 하나씩 확인을 받은 뒤에만 부른다.
/// (일괄 제거 API를 만들지 않는 이유 — src/probes/programs.ts 머리말)
/// 관리자 권한으로 올려서 실행하는 조각.
///
/// ★ 왜 필요한가: HKLM에 등록된 프로그램(= 컴퓨터 전체에 설치된 것)은 관리자만 지운다.
///   그런데 **msiexec은 권한이 없으면 UAC를 띄우지 않고 그냥 실패한다.** 그러면
///   사용자 눈에는 "제거하기를 눌렀는데 아무 일도 안 일어남"으로 보인다.
///   승격해서 띄워야 UAC 창이 정상적으로 뜨고, 사용자가 허용하면 진짜로 지워진다.
///
/// ★ 왜 문자열을 스크립트에 박지 않고 환경변수로 넘기나: 레지스트리에서 읽은 값이라도
///   스크립트 본문에 이어붙이는 순간 주입 통로가 된다. 스크립트는 **고정 문자열**이고
///   값은 TC_EXE·TC_ARGS로만 들어간다. (같은 이유·같은 방식 — src/probes/startup.ts)
const ELEVATE_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$a = $env:TC_ARGS
if ([string]::IsNullOrWhiteSpace($a)) {
  $p = Start-Process -FilePath $env:TC_EXE -Verb RunAs -Wait -PassThru -WindowStyle Hidden
} else {
  $p = Start-Process -FilePath $env:TC_EXE -ArgumentList $a -Verb RunAs -Wait -PassThru -WindowStyle Hidden
}
exit $p.ExitCode
"#;

/// 마법사를 **승격해서** 띄우는 조각. 위와 다른 점 두 가지가 전부다:
///   · `-Wait`가 없다 — 마법사는 사용자가 붙잡고 있는 창이라 우리가 기다릴 게 아니다.
///   · 창을 숨기지 않는다 — 숨기면 사용자가 진행할 창 자체가 안 보인다.
/// 승격을 거절하면 Start-Process가 던지고(ErrorActionPreference=Stop) 파워셸이
/// 0이 아닌 코드로 끝난다 → 부르는 쪽이 "안 열렸다"를 알 수 있다.
const ELEVATE_SHOW_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$a = $env:TC_ARGS
if ([string]::IsNullOrWhiteSpace($a)) {
  Start-Process -FilePath $env:TC_EXE -Verb RunAs | Out-Null
} else {
  Start-Process -FilePath $env:TC_EXE -ArgumentList $a -Verb RunAs | Out-Null
}
"#;

/// CreateProcess가 "이건 관리자로 띄워야 한다"고 거절할 때의 오류 코드.
/// (winerror.h ERROR_ELEVATION_REQUIRED)
const ERROR_ELEVATION_REQUIRED: i32 = 740;

#[tauri::command]
async fn run_uninstaller(
    command: String,
    silent: bool,
    elevate: bool,
) -> Result<UninstallOutcome, String> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return Err("제거 명령이 비어 있어요".into());
    }
    // 레지스트리에서 읽은 값만 들어온다는 전제지만, 실행 파일을 가리키는지 최소한 확인한다.
    let lower = cmd.to_lowercase();
    if !(lower.contains(".exe") || lower.contains("msiexec")) {
        return Err("실행 파일을 가리키지 않는 제거 명령이라 실행하지 않았어요".into());
    }

    let (exe, rest) = split_command_line(cmd);

    if !silent {
        // 마법사 경로 — 창을 띄우고 그 다음은 제조사와 사용자에게 맡긴다.
        let mut c = StdCommand::new(&exe);
        if !rest.is_empty() {
            c.raw_arg(&rest);
        }
        match c.spawn() {
            Ok(_) => return Ok(UninstallOutcome { waited: false, code: None }),
            // ★ 실물에서 터진 버그: 언인스톨러 상당수가 매니페스트에
            //   requireAdministrator를 달고 있다(실측: iP4U VPN). 그런 exe는
            //   CreateProcess로는 **UAC를 띄우지도 않고** 740으로 그냥 실패한다.
            //   사용자 눈에는 "제거 창 열기를 눌렀는데 아무 창도 안 뜸"이었다.
            //   여기서 포기하지 않고 승격해서 다시 띄운다 — 그러면 UAC가 정상적으로 뜬다.
            //   (무인 제거 쪽에서 needsAdmin으로 미리 승격하는 것과 같은 이유.
            //    다만 여기선 OS가 740으로 알려줄 때만 올린다 — 괜히 UAC를 띄우지 않는다.)
            Err(e) if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) => {}
            Err(e) => return Err(format!("제거 프로그램을 실행하지 못했어요: {e}")),
        }

        let mut c = StdCommand::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", ELEVATE_SHOW_SCRIPT])
            .env("TC_EXE", &exe)
            .env("TC_ARGS", &rest)
            .creation_flags(CREATE_NO_WINDOW);
        // UAC 창이 떠 있는 동안은 여기서 멈춰 있다 — 메인 스레드를 막지 않는다.
        let status = tokio::task::spawn_blocking(move || c.status())
            .await
            .map_err(|e| format!("제거 창을 기다리지 못했어요: {e}"))?
            .map_err(|e| format!("제거 프로그램을 실행하지 못했어요: {e}"))?;
        if !status.success() {
            return Err("관리자 확인이 필요한 제거 프로그램인데 확인이 취소됐어요 — 다시 눌러 '예'를 선택해 주세요".into());
        }
        return Ok(UninstallOutcome { waited: false, code: None });
    }

    let mut c = if elevate {
        // 승격이 필요한 항목 — 파워셸의 Start-Process -Verb RunAs로 올려서 부른다.
        // 파워셸 자체는 창 없이 돌고, UAC 확인 창만 사용자에게 보인다.
        let mut c = StdCommand::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", ELEVATE_SCRIPT])
            .env("TC_EXE", &exe)
            .env("TC_ARGS", &rest);
        c
    } else {
        let mut c = StdCommand::new(&exe);
        if !rest.is_empty() {
            // raw_arg — 원시 명령줄의 따옴표를 그대로 넘긴다. 다시 이스케이프하면 망가진다.
            c.raw_arg(&rest);
        }
        c
    };
    c.creation_flags(CREATE_NO_WINDOW);
    // 제거는 몇 분이 걸릴 수 있다. 블로킹 풀에서 기다린다 —
    // 메인 스레드에서 기다리면 그동안 창이 통째로 얼어붙는다.
    let status = tokio::task::spawn_blocking(move || c.status())
        .await
        .map_err(|e| format!("제거를 기다리지 못했어요: {e}"))?
        .map_err(|e| format!("제거를 시작하지 못했어요: {e}"))?;

    Ok(UninstallOutcome { waited: true, code: status.code() })
}

/// ★ 엔진 사이드카 호출 — UI와 검증된 TS 엔진을 잇는 유일한 통로.
/// 명령+인자를 주면 teraclean-engine.exe가 JSON을 돌려준다(engine-cli.ts 규약).
/// 엔진 exe는 앱 exe 바로 옆에 있다(이노셋업이 함께 설치).
///
/// ★ stderr를 한 줄씩 읽어 창으로 넘긴다 — 진행률(%)과 남은 시간이 여기로 온다.
///   전에는 `.output()`으로 프로세스가 끝날 때까지 통째로 기다렸다. 그래서 화면은
///   경과 시간밖에 보여줄 수 없었고, 14만 개를 훑는 7분 동안 사용자는 반이나 왔는지
///   멈춘 건지 알 수 없었다. 엔진은 진행 상황을 stderr에 NDJSON으로 흘리고
///   (engine-cli.ts의 progress()), 여기서 `engine-progress` 이벤트로 중계한다.
///   stdout은 그대로 결과 JSON 한 줄이다 — 규약은 바뀌지 않았다.
#[tauri::command]
async fn run_engine(
    app: tauri::AppHandle,
    command: String,
    args: Vec<String>,
    // 세울 수 있어야 하는 긴 명령만 이름을 달고 온다. 없으면 예전 그대로 돈다.
    job: Option<String>,
) -> Result<serde_json::Value, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("실행 경로를 찾을 수 없어요")?
        .to_path_buf();
    let engine = exe_dir.join("teraclean-engine.exe");

    let mut child = tokio::process::Command::new(&engine)
        // ★ 콘솔 창을 만들지 않는다 (실물에서 보인 버그).
        //   엔진 exe는 node.exe를 복사해 만든 SEA다 → **콘솔 서브시스템** 프로그램이다.
        //   콘솔이 없는 GUI 프로세스(우리 앱)가 콘솔 프로그램을 띄우면 윈도우가
        //   친절하게 새 콘솔 창을 하나 붙여준다. 그래서 탭을 누를 때마다
        //   시커먼 창이 깜빡였다. CREATE_NO_WINDOW면 콘솔 자체가 안 생긴다.
        //   (stdout은 콘솔이 아니라 파이프로 받으니 출력은 그대로 온다)
        .creation_flags(CREATE_NO_WINDOW)
        .arg(&command)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // 일감 이름이 있을 때만 stdin을 연다. 안 세우는 명령에 파이프를 달 이유가 없다.
        .stdin(if job.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .spawn()
        .map_err(|e| format!("엔진을 실행하지 못했어요: {e}"))?;

    // 손잡이를 장부에 맡긴다. 화면이 cancel_engine(job)을 부르면 여기로 닿는다.
    if let (Some(name), Some(stdin)) = (job.clone(), child.stdin.take()) {
        if let Ok(mut map) = jobs().lock() {
            map.insert(name, stdin);
        }
    }

    // ★ stderr를 반드시 계속 읽어야 한다. 파이프에는 크기가 있어서, 안 읽으면
    //   버퍼가 차는 순간 엔진이 write에서 멈춘다(교착). 진행 상황을 안 쓰는
    //   명령에서도 이 루프는 돌아야 한다.
    if let Some(err) = child.stderr.take() {
        let app = app.clone();
        // tokio::spawn이 아니라 Tauri의 런타임을 쓴다 — 이 커맨드가 어떤 실행기에서
        // 돌든 핸들이 있다고 보장되는 쪽이다(tokio::spawn은 tokio 컨텍스트 밖에서 패닉).
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // JSON 한 줄만 진행 상황이다. 그 밖의 경고문은 조용히 지나간다.
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    let _ = app.emit("engine-progress", v);
                }
            }
        });
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("엔진이 비정상 종료했어요: {e}"))?;

    // 끝난 일감은 장부에서 뺀다. 안 그러면 다음 스캔이 죽은 손잡이를 물려받는다.
    if let Some(name) = job.as_ref() {
        if let Ok(mut map) = jobs().lock() {
            map.remove(name);
        }
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|e| format!("엔진 응답을 읽지 못했어요: {e}"))
}

fn main() {
    tauri::Builder::default()
        // ★ 두 번 실행 방지는 맨 앞이어야 한다. 자동시작으로 이미 떠 있는데
        //   사용자가 바탕화면 아이콘을 또 누르면, 두 번째 프로세스는 조용히 죽고
        //   원래 창을 꺼내 온다. 이게 없으면 프로세스가 둘이 되고 트레이 아이콘도 둘이다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            /* ── 트레이 상주 (V3·알약 방식) ────────────────────────
               설치 스크립트는 자동시작을 `--minimized`로 등록해두고
               "앱이 이 인자를 해석한다"고 적어놨는데, 정작 앱에는 트레이도
               인자 처리도 없었다. 그래서 부팅할 때마다 창이 그냥 떴다.
               약속과 동작을 맞춘다. */
            let open_i = MenuItem::with_id(app, "open", "테라클린 열기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "완전히 종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .tooltip("테라클린")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    // 트레이에서 '완전히 종료'를 고를 때만 진짜 끝난다.
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // 자동시작(부팅)일 때는 창을 띄우지 않는다. 아침마다 창이 뜨는 건
            // 상주가 아니라 방해다.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        // 창을 닫아도 종료가 아니라 트레이로 내려간다 — 상주 프로그램의 기본 동작.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            apply_update,
            cancel_engine,
            download_update,
            fetch_update_manifest,
            run_engine,
            run_uninstaller
        ])
        .run(tauri::generate_context!())
        .expect("테라클린 실행 중 오류");
}
