import { SEARCH_RADIUS_KM } from './utils/geo.js'

export const projectConfig = {
  key: 'planearby',
  serviceName: 'Planearby',
  locale: 'ko',
  baseURL: '/',
  siteUrl: '',
  favicon: 'images/projects/planearby/favicon.svg',
  themeColor: '#060606',
  themeColorLight: '#f7f8fa',
  seo: {
    title: 'Planearby — 주변 항공기 실시간 레이더',
    description: `현재 위치 반경 ${SEARCH_RADIUS_KM}km 항공기의 항공사, 기종, 진행 방향과 참고 출도착 노선을 확인하세요. 주소 검색과 지도 선택을 지원하며 정상 응답 시 5초마다 갱신합니다.`,
    ogImage: 'images/projects/planearby/social-card.png',
    twitterCard: 'summary_large_image',
  },
  airlineData: {
    name: 'OpenFlights',
    repository: 'jpatokal/openflights',
    path: 'data/airlines.dat',
    sourceUrl: 'https://openflights.org/data.php#airline',
    license: 'ODbL-1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  },
  domesticAirlineData: {
    name: '항공정보포털',
    sourceUrl: 'https://www.airportal.go.kr/airline/airCompanyInfo.do',
    apiUrl: 'https://www.airportal.go.kr/airline/searchAirline.do',
    query: {
      pageNumber: 1,
      pageSize: 100,
      isActive: true,
      order: 'asc',
      orderNm: 'name',
      searchName: 'Republic of Korea',
    },
  },
}
