# Planearby ✈️

지금 내 곁을 날아가는 비행기. **Vue 3 + Vite + JavaScript + SCSS**로 만든 개인용 항공기 조회 대시보드입니다.

왼쪽 기계식 플랩 보드에는 선택한 항공기의 호출부호·항공사·기종·출발/도착 공항·현지 예정 시간을 표시합니다. 처음에는 가장 가까운 항공기를 선택하고, 10초마다 아직 보여주지 않은 항공기로 넘어가며 플랩이 순차적으로 뒤집힙니다. 레이더에서 항공기를 직접 선택할 수도 있습니다.

오른쪽 레이더에는 설정한 탐지 반경(현재 25km)의 항공기를 거리와 방위에 맞춰 배치하고, 기수로 지상 진행 방향을 표시합니다. 레이더 위쪽은 사용자가 지정하거나 휴대폰 센서로 읽은 바라보는 방향입니다.

## 로컬 실행

Node.js **22.12 이상**이 필요합니다.

```sh
npm install
npm run dev
```

표시된 로컬 주소(기본 `http://127.0.0.1:5173`)를 엽니다. 첫 화면의 항공편은 **가상의 예시 데이터**이며, 조회 시작 버튼을 눌러야 위치 권한을 요청합니다. 실제 조회에서는 예시 데이터를 섞지 않습니다.

항공기 위치는 별도 키 없이 조회합니다. 선택 사항인 운항 상세 정보에는 서버의 AirLabs 키가 필요합니다.

```sh
cp .env.example .env
```

`.env`에 본인의 키를 설정하고 개발 서버를 재시작합니다.

```dotenv
AIRLABS_API_KEY=your_api_key
ADSB_USER_AGENT=Planearby/1.0 (+https://github.com/yheun03/planearby)
AIRLABS_MONTHLY_LIMIT=1000
PORT=4173
```

키를 설정하지 않아도 위치·호출부호·제공되는 기종과 진행 방향을 표시합니다. 항공사는 호출부호를 외부 데이터셋과 매칭해 이름과 IATA 코드를 표시하고, 공항·예정 시간 등 운항 상세 정보는 `정보 없음`으로 안내합니다. `VITE_` 환경 변수에 키를 넣으면 안 됩니다. `.env`와 사용량 기록 `.data/`는 Git에서 제외합니다.

adsb.lol은 유효한 연락처가 들어간 식별용 User-Agent를 요구합니다. 기본값은 이 프로젝트 저장소 주소입니다. 포크해서 운영한다면 `ADSB_USER_AGENT`의 URL을 본인의 실제 연락 가능한 프로젝트 주소로 바꿔 주세요.

## 빌드와 실행

```sh
npm run build
npm start
```

기본 주소는 `http://127.0.0.1:4173`입니다. `npm run preview`도 같은 서버를 실행합니다. `dist/` 정적 파일과 `/api` 중계를 **Node 서버가 함께 제공**하므로 `dist/`만 정적 호스팅하면 실제 조회는 동작하지 않습니다. 외부 공개 시 HTTPS 리버스 프록시를 연결해야 합니다.

## 조회 동작

- 브라우저 위치 권한은 사용자가 조회 또는 설정의 위치 재요청 버튼을 누를 때만 요청합니다.
- 시작 버튼을 누른 시점부터 최대 30초 동안 조회하며, 위치 확인 시간도 포함합니다.
- `utils/geo.js`의 `SEARCH_RADIUS_KM`을 해리로 올림 변환해 adsb.lol에 요청하고, 응답을 Haversine 수평 거리로 다시 계산해 지정한 반경 이하인 항공기만 표시합니다. 지상 항공기와 30초보다 오래된 위치는 제외합니다.
- 약 7초마다 위치를 갱신합니다. 고도는 거리 계산에 포함하지 않습니다.
- 현재 선택한 항공기에 대해서만 AirLabs 상세 정보를 조회하고, 같은 호출부호의 결과를 세션 동안 재사용합니다. 직접 선택하거나 자동 전환하면 해당 항공편의 정보를 필요할 때 조회합니다.
- 자동 전환은 처음부터 거리순으로 미표시 항공기를 순회하고, 모두 표시하면 다시 순회합니다. 직접 선택한 뒤에는 10초 후 다음 항공기로 넘어갑니다. 보드 아래 버튼으로 일시정지할 수 있으며, 설정 창이 열려 있거나 탭이 숨겨지면 자동 전환을 멈춥니다.
- 호출부호·제공되는 기체 식별자·수신 시점·위치·운항 날짜를 검증합니다. 현재 운항과 일치한다고 확인할 수 없는 상세 정보는 표시하지 않습니다.
- 예정 시간은 각 공항의 현지 시간입니다. 실제 시간이나 지연을 반영한 예상 시간으로 표현하지 않습니다.
- 항공사 이름과 IATA/ICAO 코드는 OpenFlights의 생성된 스냅샷으로 매칭합니다. 공항·기종 이름은 기존 로컬 목록을 사용합니다. 없는 항목은 원래 코드를 표시하며 이름 조회용 추가 AirLabs 요청을 하지 않습니다.
- 중지, 시간 만료, 탭을 숨기거나 페이지를 떠날 때 타이머와 진행 중인 요청을 정리합니다.
- 빈 결과가 실제 주변에 항공기가 없다는 의미는 아닙니다. 수신 범위와 데이터 지연의 영향을 받습니다.

## 설정과 접근성

우측 아래 플로팅 버튼에서 라이트·다크·시스템 테마, 한국어·영어·일본어, 바라보는 방향, 위치 권한 재요청을 설정합니다. 테마·언어·수동 방향만 브라우저에 저장합니다. 이미 차단한 위치 권한은 브라우저의 사이트 설정에서 직접 허용해야 합니다.

- **PC:** 바라보는 방향을 0~359도 숫자, 슬라이더, 동서남북 버튼으로 지정합니다. 즉시 레이더의 항공기 위치·기수·방위 표시에 반영합니다.
- **휴대폰:** 레이더 또는 설정의 `휴대폰 방향 사용`을 눌러 센서 접근을 허용합니다. 화면을 위로 향하게 수평으로 들고 사용합니다. 센서 권한은 버튼을 눌렀을 때만 요청하며 HTTPS 또는 localhost가 필요합니다. 실제 휴대폰에서 개발 PC의 HTTP LAN 주소만 열면 센서가 제한될 수 있습니다.
- Safari의 `webkitCompassHeading` 또는 절대 방향 이벤트만 사용합니다. 보정되지 않은 값이나 상대 회전값만 오는 경우 북쪽 기준 방향이라고 표시하지 않습니다. 약 5초 동안 유효한 센서 값이 없으면 수동 방향으로 돌아갑니다.
- Safari의 나침반은 자북 기준이므로 실제 북쪽과 차이가 있을 수 있습니다. 센서 값은 근사값으로 표시하며, 자기장·기울기·기기별 오차가 있으면 수동 설정을 사용합니다. 센서 값은 저장하거나 서버에 보내지 않습니다.

시맨틱 영역, 제목 구조, 건너뛰기 링크, 키보드 포커스, 레이더 항공기의 음성 설명, 상태 안내, 기본 `<dialog>`의 포커스 제한을 적용했습니다. `prefers-reduced-motion`을 켜면 플랩 애니메이션을 생략하고 최종 글자만 표시합니다. 모바일에서는 항공기 정보 아래에 레이더를 배치합니다.

빌드 시 Vue 화면을 HTML로 사전 렌더링합니다. 언어별 문서 제목·설명·`lang`, Open Graph, WebApplication JSON-LD, `robots.txt`, `llms.txt`를 제공합니다. SEO·GEO·AEO를 위한 기초 정보이며 검색 노출을 보장하지 않습니다. 실제 도메인이 정해지면 canonical, 언어별 URL, sitemap과 공유용 이미지의 절대 URL을 배포 환경에 맞게 설정하세요.

## 서버 제한과 위치 정보

- 같은 IP에서 동시 세션 한 개, 시간당 세션 12개, 전체 동시 세션 50개로 제한합니다. 외부에서 전달한 IP 헤더는 신뢰하지 않습니다.
- 서버도 최대 30초 만료를 강제하고, 짧은 간격의 중복 위치 요청을 캐시합니다.
- 실제 발견한 호출부호만 상세 조회할 수 있으며 동시 중복 요청도 한 번으로 합칩니다.
- AirLabs 요청 전에 월 사용량을 `.data/airlabs-usage.json`에 기록합니다. 설정 한도는 최대 1,000회이며, 잘못된 기록 파일은 한도를 초기화하지 않고 요청을 차단합니다.
- 사용량은 이 앱이 실행한 요청만 계산합니다. 같은 키를 다른 곳에서도 사용하면 실제 계정 사용량과 차이가 납니다.
- 이 제한은 **개인용 단일 Node 프로세스**를 전제로 합니다. 재배포 시 `.data/`를 유지해야 합니다. 여러 인스턴스나 공개 서비스에는 인증, 공유 저장소 기반 사용량 제한과 별도 운영 검토가 필요합니다.
- 좌표는 조회 세션 동안 서버 메모리에서만 유지하고 만료 시 제거합니다. 위치를 DB·사용량 파일·애플리케이션 로그에 저장하지 않습니다. 외부 위치 API 요청에는 좌표가 전달됩니다.

## 검증

```sh
npm test
```

Node 기본 테스트 러너로 거리·방위, 바라보는 방향에 대한 상대 좌표·기수 변환, 절대/상대 센서 구분, 나침반 보정 실패, 설정된 반경의 경계 필터, 운항 일치 검증, 키 미설정, 중복 요청, 월 한도, 세션 만료와 요청 취소를 검증합니다. 외부 API와 실제 키를 사용하지 않는 테스트입니다. 실제 AirLabs 응답의 누락률과 한국 지역 수신 범위는 본인의 키 및 위치 동의 후 확인해야 합니다. 휴대폰 센서는 실제 지원 기기와 HTTPS 환경에서 별도로 확인해야 합니다.

## 파일 구성

```text
app.vue                                      앱 진입 컴포넌트
main.js                                      Vite의 Vue/SCSS 진입점
project.config.js                            프로젝트 이름·기본 SEO·이미지·데이터 출처 설정
layouts/default.vue                          공통 화면 외곽 구조
pages/index.vue                              대시보드·조회 흐름·설정
components/projects/planearby/                Planearby 전용 항공기 아이콘·기계식 플랩
assets/scss/abstract/                         CSS를 출력하지 않는 SCSS 변수·mixin
assets/scss/base/                             기본 스타일과 유틸리티 클래스
assets/scss/layout/                           레이아웃 스타일
assets/scss/projects/planearby/               테마·대시보드·설정·플랩 스타일
assets/data/airlines.json                     외부 항공사 데이터로 생성한 스냅샷
assets/data/projects/planearby/flights.js      가상의 예시와 기존 공항·기종 코드 이름
public/images/projects/planearby/             프로젝트별 favicon·공유 이미지
i18n/ko.js, en.js, ja.js, index.js             언어별 문구와 등록
utils/geo.js                                 서버·화면 공용 거리·방위·탐지 반경
utils/airlines.js                            외부 데이터 기반 항공사 코드 매칭
server/api/aircraft.js                        중계·세션·운항 검증·요청 제한
server/index.js                              빌드 결과와 API를 제공하는 서버
scripts/build.mjs                            빌드와 초기 HTML 사전 렌더링
scripts/update-airlines.mjs                   외부 항공사 데이터 스냅샷 갱신
tests/                                       거리·방위·API·항공사 매칭 테스트
```

참고한 [framework](https://github.com/yheun03/framework)는 Nuxt 기반입니다. 이 프로젝트는 기존 Vue 3 + Vite + JavaScript를 유지하면서 루트의 `app.vue`, `pages`, `layouts`, 프로젝트별 컴포넌트·SCSS·이미지와 `i18n`, `utils`, `server/api` 배치 규칙을 따릅니다. `~`는 프로젝트 루트를 가리킵니다. 사용하지 않는 라우터·스토어·타입 폴더나 Nuxt 의존성을 추가하지 않습니다.

기본 브랜드·SEO·이미지 경로는 `project.config.js`, 탐지 반경은 `utils/geo.js`에서 관리합니다. 반경 안내 문구와 경계 테스트는 같은 값을 사용합니다.

## 항공사 데이터와 누락 시 매칭

항공사 이름을 직접 작성한 코드별 목록은 사용하지 않습니다. [OpenFlights 공식 데이터](https://openflights.org/data.php#airline)에서 생성한 `assets/data/airlines.json`에 이름·IATA·ICAO를 함께 보관합니다. 자세한 출처·가공 조건·라이선스는 `assets/data/README.md`, 정확한 원본 버전과 체크섬은 JSON의 `source`에 기록됩니다.

- 현재 운항과 일치한다고 확인된 API의 IATA/ICAO 코드가 있으면 우선 사용합니다.
- 없으면 호출부호의 ICAO 접두사 또는 IATA 편명 접두사를 데이터셋과 매칭합니다. 예: `KAL1428 → KAL → KE / Korean Air`.
- API 키가 없거나 운항 상세가 확인되지 않아도 주변 항공기의 호출부호로 항공사 매칭을 수행합니다. 이 결과로 공항·예정 시간을 추정하지는 않습니다.
- 중복 코드로 항공사를 특정할 수 없거나 호출부호가 기체 등록번호와 같으면 임의로 매칭하지 않습니다. IATA가 없는 항공사에 가짜 코드를 부여하지 않습니다.
- 호출부호 기반 결과는 추정 출처를 갖습니다. 이름에는 원본 데이터의 언어를 사용하며 별도 수동 번역 표를 만들지 않습니다.
- OpenFlights의 `Active=Y` 행을 사용하지만, 공식 GitHub 데이터는 수시 갱신 스냅샷이므로 현재 운항 여부나 최신성을 보장하지 않습니다.

데이터를 갱신하려면 다음 명령을 실행합니다. 일반 실행·빌드는 네트워크나 AirLabs 이름 조회 API 없이 저장된 스냅샷을 사용합니다.

```sh
npm run data:update:airlines
```

갱신 스크립트는 공식 CSV를 커밋에 고정해 다운로드하고, CSV 파싱·검증에 성공한 경우에만 기존 파일을 교체합니다. 새 데이터와 그 `source` 변경을 확인한 뒤 함께 버전 관리하세요.

## 데이터 출처

- [adsb.lol API](https://api.adsb.lol/docs) · [공개 데이터와 ODbL 안내](https://www.adsb.lol/docs/open-data/api/)
- [OpenFlights 항공사 데이터](https://openflights.org/data.php#airline) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- [AirLabs Flight API](https://airlabs.co/docs/flight) · [요금제](https://airlabs.co/#pricing)
- [방향 센서 권한](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static) · [Safari 나침반 정확도](https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804769-webkitcompassaccuracy)

API 제공 범위·한도·이용 조건은 운영 시 최신 문서를 확인해야 합니다. 이 서비스는 호기심을 위한 관측 도구이며 항행·안전 판단에 사용할 수 없습니다.
