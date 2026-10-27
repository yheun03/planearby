<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ArrowUpRight,
  Check,
  Globe2,
  LocateFixed,
  MapPin,
  Monitor,
  Moon,
  Compass,
  Navigation2,
  Pause,
  Play,
  ScanLine,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  X,
} from '@lucide/vue'
import PlanearbyAircraftIcon from '~/components/projects/planearby/PlanearbyAircraftIcon.vue'
import PlanearbySplitFlap from '~/components/projects/planearby/PlanearbySplitFlap.vue'
import { I18N_MESSAGES as messages } from '~/i18n/index.js'
import { projectConfig } from '~/project.config.js'
import {
  aircraftModels,
  airports,
  exampleFlights,
  previewCenter,
} from '~/assets/data/projects/planearby/flights.js'
import {
  bearingDegrees,
  compassHeading,
  distanceKm,
  normalizeDegrees,
  relativeBearing,
  SEARCH_RADIUS_KM,
} from '~/utils/geo.js'

const language = ref('ko')
const theme = ref('dark')
const systemDark = ref(false)
const settingsDialog = ref(null)
const state = ref('idle')
const source = ref('preview')
const flights = ref(exampleFlights.map((flight) => ({ ...flight })))
const selectedId = ref(exampleFlights[0].id)
const selectionVersion = ref(0)
const rotationPaused = ref(false)
const manualHeading = ref(0)
const sensorHeading = ref(null)
const headingMode = ref('manual')
const compassMessage = ref('')
const compassWaiting = ref(false)
const isTouchDevice = ref(false)
const clockNow = ref(null)
const detailsAvailable = ref(false)
const detailRequests = new Map()
const seenFlightIds = new Set([exampleFlights[0].id])
let rotationTimer
let clockTimer
let compassTimer
let compassGeneration = 0
let lastSensorRender = 0
const location = ref(null)
const remaining = ref(30)
const lastUpdated = ref(null)
const errorKey = ref('')
const detailNotice = ref('')
const permission = ref('prompt')
const permissionMessage = ref('')
const checkingPermission = ref(false)
const detailCache = new Map()
let controller
let refreshTimer
let countdownTimer
let sessionId
let generation = 0
let deadline = 0
let permissionStatus
let colorScheme
let pendingStop = Promise.resolve()
let permissionController

const t = (key, values = {}) => {
  let text = messages[language.value][key] ?? messages.en[key] ?? key
  Object.entries({ radius: SEARCH_RADIUS_KM, ...values }).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value))
  })
  return text
}
const active = computed(() => ['locating', 'tracking'].includes(state.value))
const isDark = computed(
  () => theme.value === 'dark' || (theme.value === 'system' && systemDark.value),
)
const center = computed(() => (source.value === 'preview' ? previewCenter : location.value))
const aircraft = computed(() => {
  const result = flights.value
    .map((flight) => ({
      ...flight,
      distance: center.value ? distanceKm(center.value, flight) : 0,
      bearing: center.value ? bearingDegrees(center.value, flight) : 0,
    }))
    .filter((flight) => flight.distance <= SEARCH_RADIUS_KM)
  return result.sort((a, b) => a.distance - b.distance)
})
const selectedFlight = computed(
  () => aircraft.value.find((flight) => flight.id === selectedId.value) || aircraft.value[0],
)
const viewHeading = computed(() =>
  headingMode.value === 'device' && sensorHeading.value !== null
    ? sensorHeading.value
    : manualHeading.value,
)
const headingLabel = computed(
  () =>
    `${headingMode.value === 'device' ? '≈ ' : ''}${t(directionKey(viewHeading.value))} ${Math.round(viewHeading.value)}°`,
)
const clockText = computed(() =>
  clockNow.value
    ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(clockNow.value)
    : '--:--',
)
const selectedIndex = computed(
  () =>
    Math.max(
      0,
      aircraft.value.findIndex((flight) => flight.id === selectedFlight.value?.id),
    ) + 1,
)
const relativePosition = computed(() => {
  if (!selectedFlight.value) return ''
  const keys = [
    'ahead',
    'frontRight',
    'rightSide',
    'backRight',
    'behind',
    'backLeft',
    'leftSide',
    'frontLeft',
  ]
  return t(
    keys[Math.round(relativeBearing(selectedFlight.value.bearing, viewHeading.value) / 45) % 8],
  )
})
const directionKey = (angle) =>
  `direction${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(normalizeDegrees(angle) / 45) % 8]}`
const selectedBearing = computed(() => {
  if (!selectedFlight.value) return ''
  const direction = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
    Math.round(selectedFlight.value.bearing / 45) % 8
  ]
  return t('positionPhrase', { direction: t(`direction${direction}`) })
})
const statusLabel = computed(() =>
  source.value === 'preview' ? t('sample') : active.value ? t('live') : t('lastResult'),
)
const locationText = computed(() =>
  source.value === 'preview'
    ? t('previewLocation')
    : location.value
      ? t('currentLocation')
      : t('waitingLocation'),
)
const updatedText = computed(() =>
  lastUpdated.value
    ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(lastUpdated.value)
    : '—',
)
const permissionLabel = computed(() =>
  t(
    permission.value === 'granted'
      ? 'granted'
      : permission.value === 'denied'
        ? 'deniedLabel'
        : 'prompt',
  ),
)
const emptyTitle = computed(() =>
  t(
    state.value === 'locating'
      ? 'locating'
      : state.value === 'tracking' && !lastUpdated.value
        ? 'loadingTitle'
        : state.value === 'error'
          ? 'errorTitle'
          : 'emptyTitle',
  ),
)
const emptyText = computed(() =>
  t(
    state.value === 'locating'
      ? 'locatingText'
      : state.value === 'tracking' && !lastUpdated.value
        ? 'loadingText'
        : state.value === 'error'
          ? errorKey.value
          : 'emptyText',
  ),
)

const airlineName = (flight) => flight.airlineName || flight.airlineCode || t('missing')
const airportName = (code) => airports[code]?.[language.value] || code || t('missing')
const modelName = (type) => aircraftModels[type] || type || t('missing')
const flightName = (flight) => flight.callsign || flight.id.toUpperCase()
const formattedTrack = (track) => (Number.isFinite(track) ? `${Math.round(track) % 360}°` : '—')
const trackDirection = (track) =>
  Number.isFinite(track)
    ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(track / 45) % 8]
    : t('trackUnknown')
const aircraftPosition = (flight) => {
  const angle = (relativeBearing(flight.bearing, viewHeading.value) * Math.PI) / 180
  const radius = (flight.distance / SEARCH_RADIUS_KM) * 43
  return {
    left: `${50 + Math.sin(angle) * radius}%`,
    top: `${50 - Math.cos(angle) * radius}%`,
  }
}
const coordinateText = computed(() =>
  center.value
    ? `${Math.abs(center.value.lat).toFixed(4)}° ${center.value.lat >= 0 ? 'N' : 'S'}  /  ${Math.abs(center.value.lon).toFixed(4)}° ${center.value.lon >= 0 ? 'E' : 'W'}`
    : '—° N  /  —° E',
)

function getLocation(signal) {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject({ uiKey: 'insecure' })
    if (!navigator.geolocation) return reject({ uiKey: 'unsupported' })
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    let watchId
    const cleanUp = () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanUp()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        cleanUp()
        resolve(position)
      },
      (error) => {
        cleanUp()
        reject({
          uiKey: { 1: 'denied', 2: 'unavailable', 3: 'timeout' }[error.code] || 'unavailable',
        })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  })
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, signal: controller?.signal })
  const body = await response.json()
  if (!response.ok)
    throw {
      uiKey:
        { QUOTA_EXCEEDED: 'quota', RATE_LIMIT: 'rateLimit', SESSION_EXPIRED: 'expired' }[
          body.code
        ] || 'apiError',
    }
  return body
}

function finishSession(nextState = 'ended') {
  generation += 1
  controller?.abort()
  clearTimeout(refreshTimer)
  clearInterval(countdownTimer)
  if (sessionId) {
    pendingStop = fetch(`/api/session/${sessionId}`, { method: 'DELETE', keepalive: true }).catch(
      () => {},
    )
    sessionId = null
  }
  state.value = nextState
  if (nextState === 'ended' || nextState === 'error') {
    flights.value = flights.value.map((flight) =>
      ['pending', 'loading'].includes(flight.detailsStatus)
        ? { ...flight, detailsStatus: 'unavailable' }
        : flight,
    )
  }
}

async function refreshFlights(currentGeneration) {
  try {
    const response = await api(`/nearby?session=${encodeURIComponent(sessionId)}`)
    if (generation !== currentGeneration) return
    flights.value = response.aircraft.map((flight) => ({
      ...flight,
      ...(detailCache.get(flight.callsign) || {}),
      detailsStatus:
        detailCache.get(flight.callsign)?.detailsStatus ||
        (response.detailsAvailable ? 'pending' : 'unavailable'),
    }))
    lastUpdated.value = Date.now()
    detailsAvailable.value = response.detailsAvailable
    if (!aircraft.value.some((flight) => flight.id === selectedId.value))
      selectedId.value = aircraft.value[0]?.id || null
    await loadSelectedDetails(currentGeneration)
    if (generation === currentGeneration && state.value === 'tracking')
      refreshTimer = setTimeout(() => refreshFlights(currentGeneration), 7000)
  } catch (error) {
    if (generation !== currentGeneration || error.name === 'AbortError') return
    errorKey.value = error.uiKey || 'apiError'
    finishSession('error')
  }
}

async function loadSelectedDetails(currentGeneration = generation) {
  const flight = selectedFlight.value
  if (
    !flight?.callsign ||
    !detailsAvailable.value ||
    state.value !== 'tracking' ||
    !sessionId ||
    detailCache.has(flight.callsign)
  )
    return
  if (detailRequests.has(flight.callsign)) return detailRequests.get(flight.callsign)
  flights.value = flights.value.map((item) =>
    item.id === flight.id ? { ...item, detailsStatus: 'loading' } : item,
  )
  const request = (async () => {
    try {
      const detail = await api(
        `/flight?session=${encodeURIComponent(sessionId)}&callsign=${encodeURIComponent(flight.callsign)}`,
      )
      if (generation !== currentGeneration) return
      detailCache.set(flight.callsign, detail)
      flights.value = flights.value.map((item) =>
        item.id === flight.id ? { ...item, ...detail } : item,
      )
    } catch (error) {
      if (generation !== currentGeneration || error.name === 'AbortError') return
      errorKey.value = error.uiKey || 'apiError'
      finishSession('error')
    } finally {
      if (generation === currentGeneration) detailRequests.delete(flight.callsign)
    }
  })()
  detailRequests.set(flight.callsign, request)
  return request
}

function resetRotationTimer() {
  clearInterval(rotationTimer)
  if (rotationPaused.value) return
  rotationTimer = setInterval(() => {
    if (document.hidden || settingsDialog.value?.open || aircraft.value.length < 2) return
    seenFlightIds.add(selectedFlight.value?.id)
    let next = aircraft.value.find((flight) => !seenFlightIds.has(flight.id))
    if (!next) {
      seenFlightIds.clear()
      seenFlightIds.add(selectedFlight.value?.id)
      next = aircraft.value.find((flight) => flight.id !== selectedFlight.value?.id)
    }
    if (next) selectFlight(next.id)
  }, 10000)
}

function selectFlight(id) {
  selectedId.value = id
  seenFlightIds.add(id)
  resetRotationTimer()
}

const cardinalPosition = (degrees) => {
  const angle = (relativeBearing(degrees, viewHeading.value) * Math.PI) / 180
  return { left: `${50 + Math.sin(angle) * 48}%`, top: `${50 - Math.cos(angle) * 48}%` }
}

function stopCompass() {
  compassGeneration += 1
  window.removeEventListener('deviceorientation', handleOrientation)
  window.removeEventListener('deviceorientationabsolute', handleOrientation)
  clearTimeout(compassTimer)
  sensorHeading.value = null
  headingMode.value = 'manual'
  compassWaiting.value = false
}

function setManualHeading(value) {
  stopCompass()
  manualHeading.value = normalizeDegrees(Math.round(Number(value) || 0))
  compassMessage.value = ''
}

function compassUnavailable() {
  stopCompass()
  compassMessage.value = 'compassUnavailable'
}

function handleOrientation(event) {
  // These compass readings are intended for a phone held approximately level.
  if (
    (Number.isFinite(event.beta) && Math.abs(event.beta) > 70) ||
    (Number.isFinite(event.gamma) && Math.abs(event.gamma) > 70)
  ) {
    compassMessage.value = 'holdFlat'
    return
  }
  const screenAngle = window.screen.orientation?.angle ?? (Number(window.orientation) || 0)
  const heading = compassHeading(event, screenAngle)
  if (heading === null) return
  clearTimeout(compassTimer)
  compassTimer = setTimeout(compassUnavailable, 5000)
  if (performance.now() - lastSensorRender < 100 && sensorHeading.value !== null) return
  lastSensorRender = performance.now()
  const previous = sensorHeading.value
  const delta = previous === null ? 0 : normalizeDegrees(heading - previous + 180) - 180
  sensorHeading.value = previous === null ? heading : normalizeDegrees(previous + delta * 0.35)
  headingMode.value = 'device'
  compassWaiting.value = false
  compassMessage.value = 'compassApproximate'
}

async function enableCompass() {
  stopCompass()
  const current = compassGeneration
  if (!window.isSecureContext) {
    compassMessage.value = 'compassSecure'
    return
  }
  if (!window.DeviceOrientationEvent) {
    compassMessage.value = 'compassUnavailable'
    return
  }
  compassWaiting.value = true
  compassMessage.value = 'compassWaiting'
  try {
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await window.DeviceOrientationEvent.requestPermission(true)
      if (current !== compassGeneration) return
      if (permission !== 'granted') {
        compassWaiting.value = false
        compassMessage.value = 'compassDenied'
        return
      }
    }
    if (current !== compassGeneration) return
    window.addEventListener('deviceorientationabsolute', handleOrientation, { passive: true })
    window.addEventListener('deviceorientation', handleOrientation, { passive: true })
    compassTimer = setTimeout(compassUnavailable, 5000)
  } catch {
    if (current !== compassGeneration) return
    stopCompass()
    compassMessage.value = 'compassDenied'
  }
}

async function startScan() {
  if (active.value) return
  finishSession('locating')
  const currentGeneration = generation
  controller = new AbortController()
  source.value = 'live'
  location.value = null
  flights.value = []
  selectedId.value = null
  seenFlightIds.clear()
  detailsAvailable.value = false
  detailRequests.clear()
  lastUpdated.value = null
  errorKey.value = ''
  detailNotice.value = ''
  detailCache.clear()
  remaining.value = 30
  deadline = Date.now() + 30000
  countdownTimer = setInterval(() => {
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (remaining.value <= 0) finishSession()
  }, 200)
  try {
    const position = await getLocation(controller.signal)
    if (generation !== currentGeneration) return
    location.value = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
    }
    permission.value = 'granted'
    await pendingStop
    if (generation !== currentGeneration) return
    const response = await api('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: location.value.lat,
        lon: location.value.lon,
        durationMs: Math.max(1, deadline - Date.now()),
      }),
    })
    if (generation !== currentGeneration) return
    sessionId = response.id
    if (!response.detailsAvailable) detailNotice.value = 'noKey'
    state.value = 'tracking'
    await refreshFlights(currentGeneration)
  } catch (error) {
    if (generation !== currentGeneration || error.name === 'AbortError') return
    if (error.uiKey === 'denied') permission.value = 'denied'
    errorKey.value = error.uiKey || 'apiError'
    finishSession('error')
  }
}

function showPreview() {
  finishSession('idle')
  source.value = 'preview'
  location.value = null
  errorKey.value = ''
  detailNotice.value = ''
  lastUpdated.value = null
  remaining.value = 30
  flights.value = exampleFlights.map((flight) => ({ ...flight }))
  selectedId.value = exampleFlights[0].id
  seenFlightIds.clear()
  detailsAvailable.value = false
  detailRequests.clear()
}

async function requestPermission() {
  checkingPermission.value = true
  permissionMessage.value = 'locationChecking'
  try {
    permissionController = new AbortController()
    await getLocation(permissionController.signal)
    permission.value = 'granted'
    permissionMessage.value = 'locationReady'
  } catch (error) {
    if (error.name === 'AbortError') return
    if (error.uiKey === 'denied') permission.value = 'denied'
    permissionMessage.value = error.uiKey || 'unavailable'
  } finally {
    checkingPermission.value = false
  }
}

function applyPreferences() {
  document.documentElement.lang = language.value
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light'
  document.title = t('title')
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('description'))
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', t('title'))
  document
    .querySelector('meta[property="og:description"]')
    ?.setAttribute('content', t('description'))
  document
    .querySelector('meta[property="og:locale"]')
    ?.setAttribute('content', { ko: 'ko_KR', en: 'en_US', ja: 'ja_JP' }[language.value])
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      isDark.value ? projectConfig.themeColor : projectConfig.themeColorLight,
    )
  try {
    localStorage.setItem(
      'planearby-preferences',
      JSON.stringify({
        theme: theme.value,
        language: language.value,
        manualHeading: manualHeading.value,
      }),
    )
  } catch {
    /* Private browsers may disable storage. */
  }
}

function stopWhenAway() {
  if (active.value) finishSession()
}
function handleVisibility() {
  if (document.hidden) {
    stopWhenAway()
    clearInterval(rotationTimer)
    stopCompass()
    compassMessage.value = ''
  } else resetRotationTimer()
}
function handleColorScheme(event) {
  systemDark.value = event.matches
}

onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem('planearby-preferences') || '{}')
    if (['light', 'dark', 'system'].includes(saved.theme)) theme.value = saved.theme
    if (['ko', 'en', 'ja'].includes(saved.language)) language.value = saved.language
    if (Number.isFinite(saved.manualHeading))
      manualHeading.value = normalizeDegrees(saved.manualHeading)
  } catch {
    /* Use the default preferences when stored values are unavailable. */
  }
  colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = colorScheme.matches
  colorScheme.addEventListener('change', handleColorScheme)
  applyPreferences()
  isTouchDevice.value =
    window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
  clockNow.value = Date.now()
  clockTimer = setInterval(() => {
    clockNow.value = Date.now()
  }, 1000)
  resetRotationTimer()
  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('pagehide', stopWhenAway)
  if (navigator.permissions) {
    try {
      permissionStatus = await navigator.permissions.query({ name: 'geolocation' })
      permission.value = permissionStatus.state
      permissionStatus.onchange = () => {
        permission.value = permissionStatus.state
      }
    } catch {
      /* A permission prompt can still be requested without this API. */
    }
  }
})
watch([theme, language, systemDark, manualHeading], () => {
  if (typeof document !== 'undefined') applyPreferences()
})
watch(
  () => selectedFlight.value?.id,
  (id) => {
    if (!id) return
    selectedId.value = id
    seenFlightIds.add(id)
    selectionVersion.value += 1
    void loadSelectedDetails()
  },
)
watch(rotationPaused, resetRotationTimer)

onUnmounted(() => {
  finishSession()
  stopCompass()
  clearInterval(rotationTimer)
  clearInterval(clockTimer)
  permissionController?.abort()
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('pagehide', stopWhenAway)
  colorScheme?.removeEventListener('change', handleColorScheme)
  if (permissionStatus) permissionStatus.onchange = null
})
</script>

<template>
  <a
    class="skip-link"
    href="#main"
  >
    {{ t('skip') }}
  </a>
  <header class="header">
    <div class="header__identity">
      <a
        class="wordmark"
        href="#main"
        :aria-label="projectConfig.serviceName"
      >
        {{ projectConfig.serviceName }}
        <span>.</span>
      </a>
      <span class="header__count">
        {{ aircraft.length }} {{ t('aircraftLegend') }} / {{ SEARCH_RADIUS_KM }} km
      </span>
      <span class="header__status">{{ statusLabel }}</span>
    </div>
    <div class="scan-controls">
      <span>{{ t('simpleScanHint') }}</span>
      <button
        v-if="active"
        class="scan-button"
        @click="finishSession()"
      >
        <Square
          aria-hidden="true"
          :size="13"
        />
        {{ t('stop') }}
        <span>{{ remaining }}s</span>
      </button>
      <button
        v-else
        class="scan-button"
        @click="startScan"
      >
        <ScanLine
          aria-hidden="true"
          :size="15"
        />
        {{ state === 'idle' ? t('start') : t('restart') }}
      </button>
    </div>
  </header>

  <main
    id="main"
    class="dashboard"
    tabindex="-1"
  >
    <h1 class="sr-only">{{ t('hero') }}</h1>
    <div class="sky-view">
      <section
        class="flight-board"
        aria-labelledby="fids-title"
        :aria-busy="state === 'locating' || (state === 'tracking' && !lastUpdated)"
      >
        <div class="flight-board__header">
          <div>
            <h2 id="fids-title">{{ t('flightInformation') }}</h2>
            <span>FLIGHT INFORMATION</span>
          </div>
          <div class="flight-board__clock">
            <span>{{ t('localTime') }}</span>
            <PlanearbySplitFlap :text="clockText" />
          </div>
        </div>
        <div
          v-if="selectedFlight"
          class="flight-board__content"
          aria-live="polite"
          aria-atomic="true"
        >
          <dl class="flight-board__identity">
            <div>
              <dt>
                {{ t('airline') }}
                <span>Airline</span>
              </dt>
              <dd>
                <PlanearbySplitFlap
                  v-if="selectedFlight.airlineCode"
                  :text="selectedFlight.airlineCode"
                  :cycle="selectionVersion"
                />
                <span
                  v-else
                  class="flight-board__missing"
                >
                  {{ t('missing') }}
                </span>
                <small
                  :title="
                    selectedFlight.airlineSource === 'callsign' ? t('airlineInferred') : undefined
                  "
                >
                  {{ airlineName(selectedFlight) }}
                  <span
                    v-if="selectedFlight.airlineSource === 'callsign'"
                    class="sr-only"
                  >
                    · {{ t('airlineInferred') }}
                  </span>
                </small>
              </dd>
            </div>
            <div>
              <dt>
                {{ t('flightNumber') }}
                <span>Flight No.</span>
              </dt>
              <dd>
                <PlanearbySplitFlap
                  class="split-flap--callsign"
                  :class="{ 'split-flap--long': flightName(selectedFlight).length > 8 }"
                  :text="flightName(selectedFlight)"
                  :cycle="selectionVersion"
                />
              </dd>
            </div>
            <div>
              <dt>
                {{ t('aircraft') }}
                <span>Aircraft</span>
              </dt>
              <dd>
                <PlanearbySplitFlap
                  v-if="selectedFlight.type"
                  :text="selectedFlight.type"
                  :cycle="selectionVersion"
                />
                <span
                  v-else
                  class="flight-board__missing"
                >
                  {{ t('missing') }}
                </span>
                <small>{{ modelName(selectedFlight.type) }}</small>
              </dd>
            </div>
          </dl>
          <div class="board-route">
            <div class="board-route__airport">
              <h3>
                {{ t('departure') }}
                <span>From</span>
              </h3>
              <PlanearbySplitFlap
                v-if="selectedFlight.dep"
                class="split-flap--airport"
                :text="selectedFlight.dep"
                :cycle="selectionVersion"
              />
              <span
                v-else
                class="flight-board__missing"
              >
                {{ t('missing') }}
              </span>
              <p>{{ airportName(selectedFlight.dep) }}</p>
              <div class="board-route__time">
                <span>{{ t('scheduled') }}</span>
                <PlanearbySplitFlap
                  v-if="selectedFlight.depTime"
                  class="split-flap--time"
                  :text="selectedFlight.depTime"
                  :cycle="selectionVersion"
                />
                <span
                  v-else
                  class="flight-board__missing"
                >
                  {{ t('missing') }}
                </span>
              </div>
            </div>
            <div
              class="board-route__path"
              aria-hidden="true"
            >
              <span />
              <PlanearbyAircraftIcon />
              <span />
            </div>
            <div class="board-route__airport">
              <h3>
                {{ t('arrival') }}
                <span>To</span>
              </h3>
              <PlanearbySplitFlap
                v-if="selectedFlight.arr"
                class="split-flap--airport"
                :text="selectedFlight.arr"
                :cycle="selectionVersion"
              />
              <span
                v-else
                class="flight-board__missing"
              >
                {{ t('missing') }}
              </span>
              <p>{{ airportName(selectedFlight.arr) }}</p>
              <div class="board-route__time">
                <span>{{ t('scheduled') }}</span>
                <PlanearbySplitFlap
                  v-if="selectedFlight.arrTime"
                  class="split-flap--time"
                  :text="selectedFlight.arrTime"
                  :cycle="selectionVersion"
                />
                <span
                  v-else
                  class="flight-board__missing"
                >
                  {{ t('missing') }}
                </span>
              </div>
            </div>
          </div>
          <dl class="flight-board__telemetry">
            <div>
              <dt>
                {{ t('distance') }}
                <span>Distance</span>
              </dt>
              <dd>
                <PlanearbySplitFlap
                  class="split-flap--small"
                  :text="
                    selectedFlight.distance >= 1
                      ? selectedFlight.distance.toFixed(1)
                      : String(Math.round(selectedFlight.distance * 1000)).padStart(4, '0')
                  "
                  :cycle="selectionVersion"
                />
                <small>{{ selectedFlight.distance >= 1 ? 'km' : 'm' }}</small>
              </dd>
            </div>
            <div>
              <dt>
                {{ t('heading') }}
                <span>Track</span>
              </dt>
              <dd>
                <PlanearbySplitFlap
                  v-if="Number.isFinite(selectedFlight.track)"
                  class="split-flap--small"
                  :text="String(Math.round(selectedFlight.track) % 360).padStart(3, '0')"
                  :cycle="selectionVersion"
                />
                <span
                  v-else
                  class="flight-board__missing"
                >
                  {{ t('missing') }}
                </span>
                <small>
                  °
                  {{
                    Number.isFinite(selectedFlight.track)
                      ? trackDirection(selectedFlight.track)
                      : ''
                  }}
                </small>
              </dd>
            </div>
          </dl>
          <p class="flight-board__position">
            <Navigation2
              aria-hidden="true"
              :size="12"
            />
            {{ relativePosition }}
            <span>·</span>
            {{ selectedBearing }}
          </p>
          <p class="flight-board__note">
            {{
              selectedFlight.detailsStatus === 'unverified'
                ? t('unverified')
                : selectedFlight.detailsStatus === 'loading'
                  ? t('loadingDetails')
                  : t('localAirportTime')
            }}
          </p>
        </div>
        <div
          v-else
          class="fids-empty"
        >
          <h3>{{ emptyTitle }}</h3>
          <p>{{ emptyText }}</p>
        </div>
        <div class="flight-board__footer">
          <span class="flight-board__page">
            {{ String(aircraft.length ? selectedIndex : 0).padStart(2, '0') }}
            <i>/</i>
            {{ String(aircraft.length).padStart(2, '0') }}
          </span>
          <span>{{ t('autoRotate') }}</span>
          <button
            :aria-label="rotationPaused ? t('resumeRotation') : t('pauseRotation')"
            :aria-pressed="rotationPaused"
            @click="rotationPaused = !rotationPaused"
          >
            <Play
              v-if="rotationPaused"
              aria-hidden="true"
              :size="13"
            />
            <Pause
              v-else
              aria-hidden="true"
              :size="13"
            />
          </button>
        </div>
      </section>

      <section
        class="radar-panel"
        aria-labelledby="radar-title"
      >
        <h2
          id="radar-title"
          class="sr-only"
        >
          {{ t('radar') }}
        </h2>
        <div
          class="radar"
          role="group"
          :aria-label="t('radarLabel')"
        >
          <div
            class="radar__grid"
            aria-hidden="true"
          >
            <span class="radar__forward" />
            <span class="radar__ring radar__ring--outer" />
            <span class="radar__ring radar__ring--middle" />
            <span class="radar__ring radar__ring--inner" />
            <span class="radar__axis radar__axis--vertical" />
            <span class="radar__axis radar__axis--horizontal" />
          </div>
          <span
            v-for="(cardinal, index) in ['N', 'E', 'S', 'W']"
            :key="cardinal"
            class="radar__cardinal"
            :style="cardinalPosition(index * 90)"
            aria-hidden="true"
          >
            {{ cardinal }}
          </span>
          <div
            class="radar__you"
            :aria-label="source === 'preview' ? t('sampleYou') : t('you')"
            role="img"
          />
          <button
            v-for="flight in aircraft"
            :key="flight.id"
            class="radar-aircraft"
            :class="{
              'radar-aircraft--selected': selectedFlight?.id === flight.id,
              'radar-aircraft--label-left':
                Math.sin((relativeBearing(flight.bearing, viewHeading) * Math.PI) / 180) *
                  (flight.distance / SEARCH_RADIUS_KM) >
                0.45,
            }"
            :style="aircraftPosition(flight)"
            :aria-label="`${flightName(flight)}, ${flight.distance.toFixed(2)} km, ${t('bearing')} ${Math.round(flight.bearing)}°, ${t('heading')} ${formattedTrack(flight.track)}`"
            :aria-pressed="selectedFlight?.id === flight.id"
            @click="selectFlight(flight.id)"
          >
            <PlanearbyAircraftIcon
              v-if="Number.isFinite(flight.track)"
              :style="{ transform: `rotate(${relativeBearing(flight.track, viewHeading)}deg)` }"
            />
            <span
              v-else
              class="radar-aircraft__unknown"
            >
              ?
            </span>
            <span class="radar-aircraft__label">
              {{ flightName(flight) }}
              <small>{{ flight.distance.toFixed(2) }} km</small>
            </span>
          </button>
        </div>
        <div class="radar-panel__direction">
          <Navigation2
            aria-hidden="true"
            :size="13"
          />
          <span>{{ t('viewingDirection') }}</span>
          <button @click="settingsDialog.showModal()">{{ headingLabel }}</button>
          <span>{{ headingMode === 'device' ? t('sensorMode') : t('manualMode') }}</span>
        </div>
        <p class="radar-panel__caption">{{ t('radarCaption') }}</p>
        <button
          v-if="isTouchDevice && headingMode !== 'device'"
          class="compass-button"
          :disabled="compassWaiting"
          @click="enableCompass"
        >
          <Compass
            aria-hidden="true"
            :size="14"
          />
          {{ compassWaiting ? t('compassWaiting') : t('enableCompass') }}
        </button>
        <p
          v-if="isTouchDevice && compassMessage && headingMode !== 'device'"
          class="radar-panel__sensor-message"
          role="status"
        >
          {{ t(compassMessage) }}
        </p>
      </section>
    </div>
    <div
      class="scan-message"
      :class="{ 'scan-message--error': errorKey }"
      :role="errorKey ? 'alert' : 'status'"
      aria-live="polite"
    >
      <p>
        {{
          errorKey
            ? t(errorKey)
            : source === 'preview'
              ? t('simplePreview')
              : active
                ? t('liveText')
                : t('endedText')
        }}
      </p>
      <button
        v-if="errorKey"
        @click="showPreview"
      >
        {{ t('showPreview') }}
      </button>
      <p v-if="detailNotice">{{ t(detailNotice) }}</p>
    </div>
  </main>

  <footer class="footer">
    <span :title="coordinateText">
      {{ locationText }}
      <template v-if="lastUpdated">
        <span aria-hidden="true">·</span>
        {{ t('updated') }} {{ updatedText }}
      </template>
    </span>
    <p>
      <a
        href="https://www.adsb.lol/docs/open-data/api/"
        target="_blank"
        rel="noopener noreferrer"
      >
        adsb.lol
      </a>
      <a
        href="https://opendatacommons.org/licenses/odbl/1-0/"
        target="_blank"
        rel="noopener noreferrer"
      >
        ODbL 1.0
      </a>
      <span>·</span>
      <a
        href="https://airlabs.co/docs/flight"
        target="_blank"
        rel="noopener noreferrer"
      >
        AirLabs
      </a>
      <span>·</span>
      <a
        :href="projectConfig.airlineData.sourceUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        OpenFlights
      </a>
    </p>
  </footer>
  <button
    class="settings-fab"
    :aria-label="t('settings')"
    :title="t('settings')"
    aria-haspopup="dialog"
    @click="settingsDialog.showModal()"
  >
    <Settings2
      aria-hidden="true"
      :size="20"
    />
  </button>
  <dialog
    ref="settingsDialog"
    class="settings-dialog"
    aria-labelledby="settings-title"
    aria-describedby="settings-intro"
    @close="resetRotationTimer()"
    @click="
      (event) => {
        if (event.target === settingsDialog) settingsDialog.close()
      }
    "
  >
    <div class="settings-dialog__content">
      <div class="settings-dialog__heading">
        <span class="settings-dialog__icon">
          <Settings2
            aria-hidden="true"
            :size="22"
          />
        </span>
        <button
          class="icon-button"
          :aria-label="t('close')"
          @click="settingsDialog.close()"
        >
          <X
            aria-hidden="true"
            :size="21"
          />
        </button>
      </div>
      <h2 id="settings-title">{{ t('settings') }}</h2>
      <p id="settings-intro">{{ t('settingsIntro') }}</p>
      <fieldset class="setting-group">
        <legend>{{ t('appearance') }}</legend>
        <p>{{ t('appearanceHint') }}</p>
        <div class="theme-options">
          <label
            v-for="option in ['light', 'dark', 'system']"
            :key="option"
            :class="{ 'theme-options__option--selected': theme === option }"
            class="theme-options__option"
          >
            <input
              v-model="theme"
              type="radio"
              name="theme"
              :value="option"
            />
            <Sun
              aria-hidden="true"
              v-if="option === 'light'"
              :size="21"
            />
            <Moon
              aria-hidden="true"
              v-else-if="option === 'dark'"
              :size="21"
            />
            <Monitor
              aria-hidden="true"
              v-else
              :size="21"
            />
            <span>{{ t(option) }}</span>
            <Check
              aria-hidden="true"
              v-if="theme === option"
              class="theme-options__check"
              :size="13"
            />
          </label>
        </div>
      </fieldset>
      <fieldset class="setting-group">
        <legend>
          <Globe2
            aria-hidden="true"
            :size="15"
          />
          {{ t('language') }}
        </legend>
        <p>{{ t('languageHint') }}</p>
        <div class="language-options">
          <label
            v-for="option in [
              { code: 'ko', name: '한국어' },
              { code: 'en', name: 'English' },
              { code: 'ja', name: '日本語' },
            ]"
            :key="option.code"
            :lang="option.code"
          >
            <input
              v-model="language"
              type="radio"
              name="language"
              :value="option.code"
            />
            <span>{{ option.name }}</span>
            <Check
              aria-hidden="true"
              v-if="language === option.code"
              :size="15"
            />
          </label>
        </div>
      </fieldset>
      <fieldset class="setting-group heading-setting">
        <legend>
          <Compass
            aria-hidden="true"
            :size="15"
          />
          {{ t('viewingDirection') }}
        </legend>
        <p>{{ t('manualHeadingHint') }}</p>
        <div class="heading-setting__value">
          <span>{{ headingLabel }}</span>
          <label>
            <span class="sr-only">{{ t('manualAngle') }}</span>
            <input
              type="number"
              min="0"
              max="359"
              step="1"
              :value="manualHeading"
              @change="setManualHeading($event.target.value)"
            />
            <span>°</span>
          </label>
        </div>
        <input
          class="heading-setting__range"
          type="range"
          min="0"
          max="359"
          step="1"
          :value="manualHeading"
          :aria-label="t('manualAngle')"
          :aria-valuetext="`${t(directionKey(manualHeading))} ${manualHeading}°`"
          @input="setManualHeading($event.target.value)"
        />
        <div class="heading-setting__presets">
          <button
            v-for="angle in [0, 90, 180, 270]"
            :key="angle"
            :aria-pressed="headingMode === 'manual' && manualHeading === angle"
            @click="setManualHeading(angle)"
          >
            {{ t(directionKey(angle)) }}
            <small>{{ angle }}°</small>
          </button>
        </div>
        <template v-if="isTouchDevice">
          <p>{{ t('compassHint') }}</p>
          <button
            class="permission-button"
            :disabled="compassWaiting"
            @click="enableCompass"
          >
            <Compass
              aria-hidden="true"
              :size="15"
            />
            {{ compassWaiting ? t('compassWaiting') : t('enableCompass') }}
            <ArrowUpRight
              aria-hidden="true"
              :size="15"
            />
          </button>
        </template>
        <p
          v-if="compassMessage"
          class="setting-group__message"
          role="status"
        >
          {{ t(compassMessage) }}
        </p>
      </fieldset>
      <div class="setting-group setting-group--location">
        <div class="setting-group__title">
          <h3>
            <MapPin
              aria-hidden="true"
              :size="15"
            />
            {{ t('locationPermission') }}
          </h3>
          <span
            :class="{ 'permission-badge--granted': permission === 'granted' }"
            class="permission-badge"
          >
            {{ permissionLabel }}
          </span>
        </div>
        <p>{{ t('permissionHint') }}</p>
        <button
          class="permission-button"
          :disabled="checkingPermission || active"
          @click="requestPermission"
        >
          <LocateFixed
            aria-hidden="true"
            :size="16"
          />
          {{ checkingPermission ? t('locating') : t('requestPermission') }}
          <ArrowUpRight
            aria-hidden="true"
            :size="15"
          />
        </button>
        <p
          v-if="permissionMessage"
          class="setting-group__message"
          role="status"
        >
          {{ t(permissionMessage) }}
        </p>
      </div>
      <div class="settings-dialog__saved">
        <ShieldCheck
          aria-hidden="true"
          :size="14"
        />
        {{ t('saved') }}
      </div>
    </div>
  </dialog>
</template>
