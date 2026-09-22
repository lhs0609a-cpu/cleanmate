# 디자인 이미지 자산

2026-09-10 구현. 외부 이미지 서버 없이 앱과 홈페이지에 포함합니다.

## 생성 일러스트

내장 image_gen 도구로 생성한 원본은 assets/illustrations/{pc,home,storage}.png입니다.
320/640px WebP 파생본을 홈페이지 서비스 카드, 제휴 안내, 앱 정리 시작 화면에서 사용합니다.
서비스 그림은 개념 일러스트이며 실제 제휴 업체 사진이 아닙니다. 준비 중 표시는 유지합니다.

## 코드 기반 이미지

- web/public/brand: 공용 markSvg()에서 만든 마크 및 한글/영문, 밝은/어두운 배경용 워드마크. 워드마크 텍스트는 SVG 글꼴을 사용하므로 웹에서는 번들 폰트와 DOM 텍스트를 우선합니다.
- web/src/room-art.ts: 오늘의 방 9개 공간에 쓰는 테마 대응 SVG. 상태 값과 버튼 동작은 기존 DOM에 유지합니다.
- web/public/illustrations/guide-*.svg: 가이드 주제 4종.
- web/public/illustrations/state-*.svg: 완료, 후보 없음, 되돌릴 기록 없음.
- web/public/social: 한국어 메인 공유 카드 및 가이드 글별 공유 카드. 문구는 코드와 실제 가이드 제목에서 생성합니다. 메인 카드에는 예시 용량을 성과로 표시하지 않습니다.
- installer: 기존 공용 마크를 활용한 설치 마법사용 BMP.

## 재생성

npm run assets:visuals

그림 원본을 새로 생성하지 않고 WebP, SVG 및 공유 카드를 재생성합니다. 공유 카드 렌더링은 Playwright와 Microsoft Edge 및 번들 Pretendard 글꼴을 사용합니다. 일반 빌드는 저장된 자산을 사용하므로 브라우저 설치가 필요 없습니다.

## 최종 생성 프롬프트

검증: 프로덕션 빌드 통과. 브랜드·방 지도·코치·가이드 기존 테스트 53개 통과.
`npm run check:visuals`로 1440px/390px 홈페이지·앱·가이드, 공간 선택과 코치 진입,
밝은/어두운 방 지도, 이미지 로드 및 페이지 가로 넘침을 확인했습니다.
실행 화면 캡처는 output/design-review/에 있습니다. 설치 마법사 BMP와 설정은 추가했으며
Windows 설치 EXE 재빌드 및 실제 설치 검증은 이번 작업에 포함하지 않았습니다.

### PC
Create a polished editorial 3D miniature illustration for TeraClean, a calm Korean cleaning app website. Single scene: an orderly desk with a slim desktop monitor, abstract teal folder tiles on its screen, a small neatly stacked external drive and one plant. Matte ivory ceramic materials, deep teal and mint accents, warm soft daylight, restrained professional design, orthographic isometric view. Square composition, entire miniature centered with generous margin, plain very pale mint background. No text, letters, numbers, logos, people, sparkle symbols or watermarks. This is one of a cohesive series about PC cleanup, home cleaning and organized storage. Produce one high quality raster image.

### 집 청소
Create a polished editorial 3D miniature illustration for TeraClean, calm Korean cleaning app. Single scene: a clean living room corner, small ivory sofa, neatly aligned teal cushions, a mint bucket with simple cleaning tools beside sofa, small plant. Matte ivory ceramic materials, deep teal and mint accents, warm soft daylight, restrained professional design, orthographic isometric view. Square composition, entire miniature centered with generous margin, plain very pale mint background. No text, letters, numbers, logos, people, sparkles or watermarks. Cohesive series about PC cleanup, home cleaning and organized storage. One high quality raster image.

### 수납 정리
Create a polished editorial 3D miniature illustration for TeraClean, calm Korean cleaning app. Single scene: a small open ivory storage cabinet with orderly folded mint towels, a few books and matching teal storage baskets, one lower drawer open revealing neatly divided compartments. A small plant beside cabinet. Matte ivory ceramic materials, deep teal and mint accents, warm soft daylight, restrained professional design, orthographic isometric view. Square composition, entire miniature centered with generous margin, plain very pale mint background. No text, letters, numbers, logos, people, sparkles or watermarks. Cohesive series about PC cleanup, home cleaning and organized storage. One high quality raster image.
