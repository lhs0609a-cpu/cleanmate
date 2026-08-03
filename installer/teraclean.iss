; ============================================================
;  테라클린 이노셋업 스크립트
;  V3/알약 스타일: 자동설치 · 자동시작(상주) · 조용한 자동업데이트
;
;  빌드: iscc /DAppVersion=1.0.0 installer\teraclean.iss
;        → dist-installer\TeraClean-Setup-1.0.0.exe
;
;  이 exe 하나가 두 가지로 쓰인다:
;    1) 사용자 첫 설치 — 마법사 UI로 "다음 > 다음 > 완료"
;    2) 자동 업데이트 — 앱이 /VERYSILENT 로 조용히 재실행 → 무인 재설치
;       (그래서 아래 옵션들이 무인 재설치에서도 안전하게 동작해야 한다)
; ============================================================

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "테라클린"
#define AppNameEn "TeraClean"
#define AppPublisher "TeraClean"
; 실행파일 이름은 Cargo 패키지명(teraclean)에서 나온다 — 빌드 산출물과 반드시
; 같아야 한다(release.yml이 이 이름으로 복사한다).
#define AppExeName "teraclean.exe"
; ★ 자동 업데이트 시 "현재 실행 중인 앱"을 안전히 닫기 위한 고유 식별자.
;   바꾸면 기존 설치를 '다른 앱'으로 보고 나란히 설치된다 — 이름이 바뀌어도 유지한다.
;   (2026-08-03 리브랜딩 때 일괄 치환으로 한 번 바뀔 뻔했다. 여기 문자열은 브랜드가
;    아니라 '설치 신원'이다 — 클린메이트 시절 설치본을 덮어쓰려면 그대로여야 한다.)
#define AppId "{{8F3A1C24-9B7E-4D2A-8E6F-CLEANMATE0001}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
VersionInfoVersion={#AppVersion}
; 사용자 폴더에 설치 → 관리자 권한 없이도 설치/업데이트 가능(최소 권한 원칙).
; 시스템 작업(powercfg 등)은 앱이 그때그때 UAC로 승격한다. 설치 자체는 조용히.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppNameEn}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
OutputDir=..\dist-installer
OutputBaseFilename=TeraClean-Setup-{#AppVersion}
; 서명은 이 파일이 아니라 CI(release.yml)가 한다 — 앱 바이너리는 iscc 전에,
; 설치파일은 iscc 뒤에 signtool로 서명한다. 인증서 시크릿이 없으면 건너뛴다.
; (여기에 SignTool= 를 쓰면 iscc가 서명 도구 설정을 따로 요구해 이중관리가 된다.)
SetupLogging=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "autostart"; Description: "윈도우 시작 시 자동 실행 (백그라운드에서 조용히 관리)"; GroupDescription: "시작 옵션:"
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "바로가기:"

[InstallDelete]
; ★ 클린메이트 시절 파일·자동시작을 걷어낸다.
;   이름을 바꾸면서 exe 이름도 바뀌었는데(cleanmate.exe → teraclean.exe),
;   이노셋업은 모르는 파일을 지우지 않는다. 그래서 업그레이드해도 옛 exe가
;   그대로 남고, 옛 자동시작 항목이 그 파일을 계속 실행한다 —
;   부팅할 때마다 '구버전 앱'이 뜨는 셈이다. 실측에서 실제로 그랬다.
Type: files; Name: "{app}\cleanmate.exe"
Type: files; Name: "{app}\cleanmate-engine.exe"

[Files]
; Tauri 빌드 산출물 전체(exe + 사이드카 엔진 + 리소스)를 통째로 담는다.
; CI가 이 폴더를 채운다(release.yml).
Source: "..\dist-app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; ★ 옛 이름으로 등록된 자동시작을 먼저 지운다. 안 지우면 부팅 때 구버전 exe가
;   같이 실행된다(설치 폴더에서 옛 exe는 [InstallDelete]가 지우므로, 남은
;   항목은 없는 파일을 가리키는 유령이 된다).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: none; ValueName: "CleanMate"; Flags: deletevalue

; ★ 자동 시작(상주). V3/알약처럼 부팅 시 트레이에 조용히 뜬다.
; --minimized: 창을 띄우지 않고 트레이로 시작(앱이 이 인자를 해석).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#AppNameEn}"; \
  ValueData: """{app}\{#AppExeName}"" --minimized"; \
  Flags: uninsdeletevalue; Tasks: autostart

[Run]
; 설치/업데이트 후 앱 실행 — 경로에 따라 아래 두 줄 중 하나만 탄다(배타적).
;   수동 설치: 1번 줄. postinstall이라 완료 화면의 체크박스가 되고, 창을 띄운다.
;   자동 업데이트: 2번 줄. WizardSilent일 때만 돌고 트레이로 조용히 재시작한다.
; nowait: 설치 프로그램이 앱을 기다리지 않고 끝남.
; runasoriginaluser: 업데이트 설치가 승격돼 있어도 앱은 원래 사용자 권한으로 띄운다.
Filename: "{app}\{#AppExeName}"; Parameters: "--updated"; \
  Description: "{#AppName} 실행"; Flags: nowait postinstall skipifsilent
; 무인(자동 업데이트) 경로에서는 트레이로 조용히 재시작
Filename: "{app}\{#AppExeName}"; Parameters: "--minimized --updated"; \
  Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallDelete]
; 앱 설정/캐시는 지우되, 사용자의 격리함(.teraclean·옛 .cleanmate)은 건드리지 않는다 —
; 제거해도 "되돌릴 수 있는 파일"은 사용자 것이다.
Type: filesandordirs; Name: "{localappdata}\{#AppNameEn}\cache"

[Code]
// 자동 업데이트(무인 재설치) 시, 실행 중인 앱을 안전하게 닫는다.
// 이노셋업이 {#AppId}로 이전 버전을 인식하고 CloseApplications로 처리하지만,
// 트레이 상주 앱은 명시적으로 종료 신호를 준다.
function InitializeSetup(): Boolean;
begin
  Result := True;
  // (필요 시: 실행 중인 teraclean.exe에 종료 요청 — 앱이 --updated 재시작을 처리)
end;
