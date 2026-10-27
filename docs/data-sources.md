# 사용하는 API와 데이터셋

화면은 정적 Vue 앱이며 위치 조회에는 이 프로젝트의 서버 중계가 필요합니다. 유료 데이터 API·API 키·30초 세션 제한을 사용하지 않습니다. GitHub Pages의 실시간 조회에는 별도 함수 호스팅의 주소가 필요합니다. 주소가 없어도 빌드·배포할 수 있으며, 예시 화면 보기 버튼으로 가상 데이터 12개를 표시합니다. 이 배포에서는 위치 권한이나 데이터 API를 자동 요청하지 않습니다.

## 브라우저 Geolocation API

위치 권한을 받아 조회 기준 좌표를 확인합니다. HTTPS 또는 localhost가 필요하며, 차단된 권한을 앱이 자동으로 해제할 수는 없습니다. 현재 위치는 조회 시작 시 확인하고 다시 조회할 때 새로 확인합니다. 앱에서 좌표를 저장하거나 로그로 남기지 않습니다.

공식 문서: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API

## adsb.lol — 항공기의 수신 위치

`GET https://api.adsb.lol/v2/point/{latitude}/{longitude}/{radius_nm}`

사용 필드는 `hex`, `flight`, `lat`, `lon`, `track`, `t`, `r`, `seen_pos`, `alt_baro`, `category`입니다. 5초 간격으로 요청하며 중복 위치 요청은 만들지 않습니다. 현재 설정은 반경 25km이며 해리로 올림해 요청한 뒤 원래 사용자 좌표의 수평 거리로 다시 필터링합니다. 지상 항공기, 오래된 위치, 표시 대상이 아닌 기종과 헬기를 제외합니다.

공개 데이터의 라이선스는 ODbL 1.0입니다. 위치 수신 범위와 지연에 따라 실제 항공기를 놓칠 수 있습니다.

공식 안내: https://www.adsb.lol/docs/open-data/api/

## 앱의 위치 중계 — CORS 처리

`GET /api/aircraft?lat={latitude}&lon={longitude}`

adsb.lol은 브라우저 CORS를 지원하지 않으므로 `api/aircraft.js`가 고정된 adsb.lol URL만 요청합니다. 좌표 범위를 검증하고 반경은 서버의 설정값으로 제한합니다. 호출자가 임의 URL이나 반경을 지정할 수 없습니다. API 키·로그인·결제 정보를 보내지 않으며 응답은 `no-store`입니다. 30초보다 오래된 수신 데이터는 클라이언트에서 제외합니다.

개발·미리보기에서는 Vite가 같은 함수를 연결합니다. 개발 모드는 배포용 주소와 관계없이 로컬 `/api/aircraft`를 사용합니다. Vercel에서는 `api/aircraft.js`를 Node 함수로 실행할 수 있습니다. GitHub Pages는 이 함수를 실행할 수 없으므로 별도 함수 배포 후 `.env.pages.local`의 `VITE_AIRCRAFT_API_URL`에 실제 공개 API 주소를 지정해야 합니다. 예시 문구나 GitHub Pages 화면 주소를 값으로 넣지 않습니다. 키가 아니며 클라이언트 빌드에 포함됩니다. 함수 호스팅에는 제공자의 무료 플랜 한도가 적용됩니다.

근사 좌표(소수점 셋째 자리)가 중계 호스팅과 원본 API에 전달됩니다. 공항 노선 요청은 이 중계를 거치지 않습니다. 원본은 부하에 따라 제한이 달라지며 429의 `Retry-After`를 따릅니다. 403은 별도 안내 후 5분 대기합니다. 정상 위치 요청은 탭당 분당 최대 12회입니다. 중계 서버의 여러 사용자는 원본에서 같은 IP로 보일 수 있습니다. 무제한·무중단 접근을 보장하지 않습니다.

기존 Jina Reader 공개 중계는 일부 환경에서 403이 발생해 제거했습니다. 다른 제3자 공개 프록시로 자동 전환하지 않습니다.

## adsbdb — 출발·도착 공항

`GET https://api.adsbdb.com/v0/callsign/{callsign}`

`response.flightroute`의 호출부호와 `origin`·`destination`의 IATA/ICAO 코드·공항 이름을 사용합니다. 선택한 항공편만 조회하고 동시 요청을 합칩니다. 성공 결과는 6시간, 미등록 결과는 1시간 동안 메모리에서 재사용합니다. 네트워크 오류는 잠시 대기 후 재시도하며 위치 조회는 계속됩니다.

이 정보는 날짜·스케줄이 없는 **참고 노선**입니다. 오늘의 실제 운항과 다를 수 있습니다. 없으면 `NON` 칸을 표시하고 공항이나 시간을 추정하지 않습니다.

공식 응답 문서: https://github.com/mrjackwills/adsbdb

## 항공정보포털 — 국내 항공사 코드와 이름

`POST https://www.airportal.go.kr/airline/searchAirline.do`

항공정보포털의 공개 항공사 디렉터리에서 대한민국의 운영 중 항공사 목록을 받아 `assets/data/airlines-kr.json`으로 생성합니다. `name`·`name2`·`iataCode`·`icaoCode`를 사용하며 한국어 화면에서는 원본 한국어 이름을 표시합니다. 조회 조건·응답 체크섬·수집 시각·출처를 스냅샷에 기록합니다. 현재 스냅샷은 13개 항공사입니다.

이 목록을 OpenFlights보다 우선해 신규 LCC 누락과 과거 IATA/ICAO 코드 재사용을 보완합니다. 예를 들어 `PTA/WE`는 파라타항공, `ASV/RS`는 에어서울로 연결합니다. 충돌하는 과거 OpenFlights 항목은 매칭에서 제외하며 수동 이름 예외 목록을 두지 않습니다. adsbdb 응답의 항공사 이름은 이 매칭을 덮어쓰지 않습니다.

공개 디렉터리: https://www.airportal.go.kr/airline/airCompanyInfo.do

## OpenFlights — 해외 항공사와 기종 데이터셋

- 원본 저장소: https://github.com/jpatokal/openflights
- `data/airlines.dat` → `assets/data/airlines.json`: 항공사 이름·IATA·ICAO 코드. 호출부호 접두사로 매칭하며 모호한 코드는 추정하지 않습니다.
- `data/planes.dat` → `assets/data/planes.json`: 기종 이름과 표시 대상 여부. 에어버스·보잉·봄바르디어 계열과 구 Canadair CRJ/Challenger·Dash 8을 포함하며 GLEX는 제외합니다.

항공사·기종·공항 이름을 수동 코드별 목록으로 유지하지 않습니다. 원본 스냅샷은 최신성을 보장하지 않으며 없는 코드는 원래 값으로 표시합니다. 원본 커밋·체크섬·다운로드 시각과 ODbL 1.0 라이선스를 OpenFlights JSON에 기록합니다. 항공정보포털 스냅샷은 출처를 별도로 기록하며 원본 사이트의 이용 조건을 따릅니다. 상세 가공 조건은 `assets/data/README.md`에 있습니다.

```sh
npm run data:update:airlines
npm run data:update:aircraft
```

일반 빌드나 화면 요청은 스냅샷을 다시 다운로드하지 않습니다. `assets/data/projects/planearby/flights.js`의 가상 관측은 명시적인 예시 화면에만 사용하며 실제 조회에는 섞지 않습니다.

공식 데이터 안내: https://openflights.org/data.php
