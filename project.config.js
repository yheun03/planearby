import { SEARCH_RADIUS_KM } from './utils/geo.js'

export const projectConfig = {
  key: 'planearby',
  serviceName: 'Planearby',
  locale: 'ko',
  baseURL: '/',
  siteUrl: '',
  favicon: 'images/projects/planearby/favicon.svg',
  themeColor: '#060606',
  themeColorLight: '#f5f4ef',
  seo: {
    title: 'Planearby — 지금 내 곁을 날아가는 비행기',
    description: `현재 위치 반경 ${SEARCH_RADIUS_KM}km의 항공편과 비행 방향을 30초 동안 살펴보세요. 내 곁의 작은 하늘 관측소, Planearby.`,
    ogImage: 'images/projects/planearby/social-card.svg',
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
}
