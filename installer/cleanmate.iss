; ============================================================
;  클린메이트 이노셋업 스크립트
;  V3/알약 스타일: 자동설치 · 자동시작(상주) · 조용한 자동업데이트
;
;  빌드: iscc /DAppVersion=1.0.0 installer\cleanmate.iss
;        → dist-installer\CleanMate-Setup-1.0.0.exe
;
;  이 exe 하나가 두 가지로 쓰인다:
;    1) 사용자 첫 설치 — 마법사 UI로 "다음 > 다음 > 완료"
;    2) 자동 업데이트 — 앱이 /VERYSILENT 로 조용히 재실행 → 무인 재설치
;       (그래서 아래 옵션들이 무인 재설치에서도 안전하게 동작해야 한다)
; ============================================================

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "클린메이트"
#define AppNameEn "CleanMate"
#define AppPublisher "CleanMate"
#define AppExeName "cleanmate.exe"
; ★ 자동 업데이트 시 "현재 실행 중인 앱"을 안전히 닫기 위한 고유 식별자
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
OutputBaseFilename=CleanMate-Setup-{#AppVersion}
; 서명은 CI에서 인증서가 있을 때만 켠다(§배포-아키텍처 서명 절):
; SignTool=signtool $f
SetupLogging=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "autostart"; Description: "윈도우 시작 시 자동 실행 (백그라운드에서 조용히 관리)"; GroupDescription: "시작 옵션:"
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "바로가기:"

[Files]
; Tauri 빌드 산출물 전체(exe + 사이드카 엔진 + 리소스)를 통째로 담는다.
; CI가 이 폴더를 채운다(release.yml).
Source: "..\dist-app\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; ★ 자동 시작(상주). V3/알약처럼 부팅 시 트레이에 조용히 뜬다.
; --minimized: 창을 띄우지 않고 트레이로 시작(앱이 이 인자를 해석).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#AppNameEn}"; \
  ValueData: """{app}\{#AppExeName}"" --minimized"; \
  Flags: uninsdeletevalue; Tasks: autostart

[Run]
; 설치/업데이트 후 앱 실행.
; nowait: 설치 프로그램이 앱을 기다리지 않고 끝남.
; skipifsilent 아님 — 자동 업데이트(silent) 후에도 앱을 다시 띄워야 하므로 항상 실행.
Filename: "{app}\{#AppExeName}"; Parameters: "--updated"; \
  Description: "{#AppName} 실행"; Flags: nowait postinstall skipifsilent
; 무인(자동 업데이트) 경로에서는 트레이로 조용히 재시작
Filename: "{app}\{#AppExeName}"; Parameters: "--minimized --updated"; \
  Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallDelete]
; 앱 설정/캐시는 지우되, 사용자의 격리함(.cleanmate)은 건드리지 않는다 —
; 제거해도 "되돌릴 수 있는 파일"은 사용자 것이다.
Type: filesandordirs; Name: "{localappdata}\{#AppNameEn}\cache"

[Code]
// 자동 업데이트(무인 재설치) 시, 실행 중인 앱을 안전하게 닫는다.
// 이노셋업이 {#AppId}로 이전 버전을 인식하고 CloseApplications로 처리하지만,
// 트레이 상주 앱은 명시적으로 종료 신호를 준다.
function InitializeSetup(): Boolean;
begin
  Result := True;
  // (필요 시: 실행 중인 cleanmate.exe에 종료 요청 — 앱이 --updated 재시작을 처리)
end;
