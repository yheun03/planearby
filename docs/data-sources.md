# 사용하는 API와 데이터셋

화면은 정적 Vue 앱입니다. GitHub Pages에서는 무료 공개 `cors.dev` 중계로 `adsb.lol`을 조회하므로 별도 서버 배포나 환경 변수 없이 실시간 조회가 가능합니다. API 키·계정·결제 정보·30초 세션 제한은 사용하지 않습니다. 원본 데이터 API의 일일 호출 한도는 적용됩니다.

## 브라우저 Geolocation API

위치 권한을 받아 조회 기준 좌표를 확인합니다. HTTPS 또는 localhost가 필요하며, 차단된 권한을 앱이 자동으로 해제할 수는 없습니다. 현재 위치는 조회 시작 시 확인하고 다시 조회할 때 새로 확인합니다. 앱에서 좌표를 저장하거나 로그로 남기지 않습니다.

공식 문서: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API

## 위치 직접 선택 — Leaflet·OpenStreetMap

GPS 권한을 사용할 수 없으면 지도에서 위치를 선택하거나 위도·경도를 입력합니다. `PlanearbyLocationPicker.vue`는 창을 열 때 Leaflet을 지연 로드하고 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`로 현재 지도 영역만 표시합니다. 타일 출처를 표시하고 브라우저의 기본 캐시·Referer 정책을 유지합니다. 타일 선행 수집이나 장소 검색 API는 사용하지 않습니다. 지도가 실패해도 숫자 입력은 계속 사용할 수 있습니다.

확정한 좌표는 GPS를 호출하지 않고 기존 adsb.lol 위치 조회에 전달합니다. 자동 위치 권한 거부는 수동 조회를 중지하지 않습니다. 선택한 위치는 브라우저 메모리에만 유지하며 저장하지 않습니다. 지도 열기·드래그·좌표 편집 자체는 항공기 API 요청을 추가하지 않지만, 이미 실행 중인 조회는 위치를 확정하기 전까지 기존 위치에서 계속됩니다.

Leaflet: https://leafletjs.com/

지도 타일 정책: https://operations.osmfoundation.org/policies/tiles/

## adsb.lol — 항공기의 수신 위치

`GET https://api.adsb.lol/v2/point/{latitude}/{longitude}/{radius_nm}`

사용 필드는 `hex`, `flight`, `lat`, `lon`, `track`, `t`, `r`, `seen_pos`, `alt_baro`, `category`입니다. 5초 간격으로 요청하며 중복 위치 요청은 만들지 않습니다. 현재 설정은 반경 25km이며 해리로 올림해 요청한 뒤 원래 사용자 좌표의 수평 거리로 다시 필터링합니다. 지상 항공기, 오래된 위치, 표시 대상이 아닌 기종과 헬기를 제외합니다.

공개 데이터의 라이선스는 ODbL 1.0입니다. 위치 수신 범위와 지연에 따라 실제 항공기를 놓칠 수 있습니다.

공식 안내: https://www.adsb.lol/docs/open-data/api/

## 정적 배포 — 무료 CORS 중계

`GET https://proxy.cors.dev/https://api.adsb.lol/v2/point/{latitude}/{longitude}/{radius_nm}`

adsb.lol 응답에는 브라우저 CORS 허용 헤더가 없어 공개 중계가 해당 헤더를 추가합니다. GitHub Pages를 포함한 정적 빌드는 이 주소를 기본으로 사용합니다. 쿠키·API 키·인증 정보·referrer를 보내지 않고, 캐싱이나 유료 기능을 요청하지 않습니다. 응답은 `no-store`이며 HTTP 오류와 `Retry-After`, `X-RateLimit-*` 헤더가 브라우저에 전달됩니다. 30초보다 오래된 수신 데이터는 표시하지 않습니다.

cors.dev 공식 문서는 무료 GET/HEAD에 IP당 분당 600회, 일일·월간 한도 없음으로 안내합니다. 이는 **중계 서비스 한도**이며 adsb.lol의 한도를 없애지 않습니다. 2026-10-28 실제 응답에서 `X-RateLimit-Limit: 4, 4;w=1, 60;w=60, 500;w=86400`과 GitHub Pages origin에 대한 CORS 허용을 확인했습니다. 원본의 IP별 한도는 중계의 다른 사용자들과 공유될 수 있습니다. 무료 서비스의 운영·접근 정책과 가용성은 보장할 수 없습니다.

공식 중계 문서: https://cors.dev/docs

## 개발·선택적 자체 중계

`GET /api/aircraft?lat={latitude}&lon={longitude}`

`api/aircraft.js`는 고정된 adsb.lol URL만 요청합니다. 좌표 범위를 검증하고 반경은 서버의 설정값으로 제한합니다. 호출자가 임의 URL이나 반경을 지정할 수 없습니다. 응답은 `no-store`이며 원본의 `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`을 보존하고 CORS로 노출합니다.

Vite는 개발·미리보기에서 같은 함수를 제공합니다. 개발 모드는 배포용 주소와 관계없이 로컬 `/api/aircraft`를 사용합니다. 정적 빌드는 기본으로 공개 중계를 사용하고, 자체 함수를 배포한 경우에만 `VITE_AIRCRAFT_API_URL`로 주소를 덮어쓸 수 있습니다. Pages 전용 설정은 `.env.pages.local`에 둡니다. 예시 문구나 GitHub Pages 화면 주소를 값으로 넣지 않습니다. API 주소는 공개 값이며 비밀 키가 아닙니다. 자체 함수 호스팅에는 해당 서비스의 무료 플랜 한도가 적용됩니다.

근사 좌표(소수점 셋째 자리)가 공개 또는 자체 중계와 원본 API에 전달됩니다. 공항 노선 요청은 이 중계를 거치지 않습니다. 정상 위치 요청은 탭당 분당 최대 12회입니다. 일시적 429는 `Retry-After`와 `X-RateLimit-Reset`을 따르고 403은 5분 이상 대기합니다.

429의 `X-RateLimit-Limit` 첫 값은 활성 한도입니다. 뒤의 정책 중 같은 한도의 `w`가 86400초 이상이고 잔여량이 0이면 일일 한도 소진으로 처리합니다. 전체 화면 모달로 토큰 소진을 알리고 자동 조회와 진행 중인 요청을 중지합니다. 같은 페이지에서 초기화 전 재시작하면 추가 요청 없이 모달을 다시 표시합니다. 초기화 헤더가 없을 때는 보수적으로 24시간 대기합니다. 헤더가 없는 429는 소진 여부를 확인할 수 없어 일시 제한으로 처리합니다. 다른 프록시나 데이터 제공자로 자동 전환하지 않습니다.

한도 헤더 형식: https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ratelimit/v3/rate_limit.proto

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
