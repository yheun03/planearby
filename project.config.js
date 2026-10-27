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
    description: `현재 위치 반경 ${SEARCH_RADIUS_KM}km 항공기의 항공사, 기종, 출도착 공항과 진행 방향을 확인하세요. 무료 항공편 보드와 레이더가 5초 간격으로 갱신됩니다.`,
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
