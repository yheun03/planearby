<script setup>
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { MapPin, Minus, Plus, Search, X } from '@lucide/vue'
import { I18N_MESSAGES as messages } from '~/i18n/index.js'
import { SEARCH_RADIUS_KM } from '~/utils/geo.js'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  initialLocation: { type: Object, required: true },
  language: { type: String, default: 'ko' },
})
const emit = defineEmits(['select', 'close'])
const dialog = ref(null)
const mapElement = ref(null)
const searchInput = ref(null)
const applyButton = ref(null)
const latitude = ref('')
const longitude = ref('')
const mapLoading = ref(false)
const mapUnavailable = ref(false)
const mapReady = ref(false)
const validationMessage = ref('')
const searchQuery = ref('')
const searchResults = ref([])
const searchMessage = ref('')
const searching = ref(false)
const searchCache = new Map()
let searchController
let lastSearchAt = -Infinity
let map
let generation = 0

const t = (key) =>
  (messages[props.language]?.[key] || messages.en[key] || key).replaceAll(
    '{radius}',
    String(SEARCH_RADIUS_KM),
  )
const selectedLocation = computed(() => {
  const lat = Number(latitude.value)
  const lon = Number(longitude.value)
  if (
    String(latitude.value).trim() === '' ||
    String(longitude.value).trim() === '' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return null
  return { lat, lon }
})

function destroyMap() {
  generation += 1
  cancelSearch()
  map?.off()
  map?.remove()
  map = null
  mapReady.value = false
  mapLoading.value = false
}

function handleClose() {
  if (dialog.value?.open) return
  destroyMap()
  emit('close')
}

function close() {
  dialog.value?.close()
}

async function open() {
  if (!dialog.value || dialog.value.open) return
  destroyMap()
  latitude.value = props.initialLocation.lat.toFixed(5)
  longitude.value = props.initialLocation.lon.toFixed(5)
  validationMessage.value = ''
  searchQuery.value = ''
  searchResults.value = []
  searchMessage.value = ''
  mapUnavailable.value = false
  mapLoading.value = true
  const current = ++generation
  dialog.value.showModal()
  await nextTick()
  searchInput.value?.focus({ preventScroll: true })
  if (current !== generation || !dialog.value?.open) return
  try {
    const module = await import('leaflet')
    if (current !== generation || !dialog.value?.open) return
    const leaflet = module.default || module
    const center = selectedLocation.value || props.initialLocation
    map = leaflet.map(mapElement.value, {
      center: [center.lat, center.lon],
      zoom: 11,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      worldCopyJump: true,
    })
    map.on('moveend', (event) => {
      if (current !== generation || !dialog.value?.open) return
      const center = event.target.getCenter().wrap()
      latitude.value = center.lat.toFixed(5)
      longitude.value = center.lng.toFixed(5)
      validationMessage.value = ''
    })
    map.on('click', (event) => map?.panTo(event.latlng, { animate: false }))
    leaflet
      .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      })
      .on('load', () => {
        if (current === generation) mapLoading.value = false
      })
      .on('tileerror', () => {
        if (current !== generation) return
        mapLoading.value = false
        mapUnavailable.value = true
      })
      .addTo(map)
    mapReady.value = true
    map.invalidateSize()
  } catch {
    if (current !== generation || !dialog.value?.open) return
    map?.remove()
    map = null
    mapReady.value = false
    mapLoading.value = false
    mapUnavailable.value = true
  }
}

function cancelSearch() {
  searchController?.abort()
  searching.value = false
}

function editSearch() {
  cancelSearch()
  searchResults.value = []
  searchMessage.value = ''
}

async function searchAddress() {
  const query = searchQuery.value.trim()
  if (!query || searching.value) return
  const cacheKey = `${props.language}:${query}`
  const cached = searchCache.get(cacheKey)
  if (cached) {
    searchResults.value = cached
    searchMessage.value = cached.length ? '' : 'addressNoResults'
    return
  }
  if (Date.now() - lastSearchAt < 1000) return
  lastSearchAt = Date.now()
  cancelSearch()
  const controller = new AbortController()
  searchController = controller
  const current = generation
  searching.value = true
  searchResults.value = []
  searchMessage.value = ''
  try {
    const queryParams = new URLSearchParams({ q: query, limit: '5' })
    const endpoint = import.meta.env?.VITE_GEOCODING_API_URL || 'https://photon.komoot.io/api/'
    const response = await fetch(`${endpoint}?${queryParams}`, {
      credentials: 'omit',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    })
    if (!response.ok) throw new Error('Address search unavailable')
    const body = await response.json()
    if (controller.signal.aborted || current !== generation || !dialog.value?.open) return
    if (!Array.isArray(body.features)) throw new Error('Invalid search response')
    const results = body.features
      .filter((item) => {
        const [lon, lat] = item.geometry?.coordinates || []
        return (
          item.geometry?.type === 'Point' &&
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180
        )
      })
      .slice(0, 5)
      .map((item, index) => {
        const details = item.properties || {}
        return {
          id: `${details.osm_type || ''}-${details.osm_id || index}`,
          name: details.name || details.street || query,
          address: [
            ...new Set(
              [
                details.country,
                details.state,
                details.city,
                details.district,
                details.street,
                details.housenumber,
                details.postcode,
              ].filter(Boolean),
            ),
          ].join(' '),
          lat: item.geometry.coordinates[1],
          lon: item.geometry.coordinates[0],
        }
      })
    if (searchCache.size >= 30) searchCache.delete(searchCache.keys().next().value)
    searchCache.set(cacheKey, results)
    searchResults.value = results
    searchMessage.value = results.length ? '' : 'addressNoResults'
  } catch {
    if (!controller.signal.aborted && current === generation)
      searchMessage.value = 'addressSearchError'
  } finally {
    if (searchController === controller) searching.value = false
  }
}

async function selectAddress(result) {
  latitude.value = String(result.lat)
  longitude.value = String(result.lon)
  map?.panTo([result.lat, result.lon], { animate: false })
  searchResults.value = []
  searchMessage.value = 'addressSelected'
  validationMessage.value = ''
  await nextTick()
  applyButton.value?.focus()
}

function updateMapCenter() {
  validationMessage.value = ''
  if (!selectedLocation.value) {
    validationMessage.value = 'invalidCoordinates'
    return
  }
  map?.panTo([selectedLocation.value.lat, selectedLocation.value.lon], { animate: false })
}

function applyLocation() {
  if (!selectedLocation.value) {
    validationMessage.value = 'invalidCoordinates'
    return
  }
  const location = { ...selectedLocation.value }
  close()
  emit('select', location)
}

defineExpose({ open, close })
onUnmounted(destroyMap)
</script>

<template>
  <dialog
    ref="dialog"
    class="location-dialog"
    aria-labelledby="location-picker-title"
    aria-describedby="location-picker-hint"
    @close="handleClose"
    @click="
      (event) => {
        if (event.target === dialog) close()
      }
    "
  >
    <div class="location-dialog__content">
      <div class="location-dialog__heading">
        <span class="location-dialog__icon">
          <MapPin
            aria-hidden="true"
            :size="22"
          />
        </span>
        <button
          class="icon-button"
          :aria-label="t('closeLocationPicker')"
          @click="close"
        >
          <X
            aria-hidden="true"
            :size="21"
          />
        </button>
      </div>
      <h2 id="location-picker-title">{{ t('locationPickerTitle') }}</h2>
      <p id="location-picker-hint">{{ t('locationPickerHint') }}</p>

      <div class="location-picker">
        <form
          class="location-picker__search"
          role="search"
          :aria-busy="searching"
          @submit.prevent="searchAddress"
        >
          <label for="location-address">{{ t('addressSearch') }}</label>
          <div class="location-picker__search-field">
            <Search
              :size="18"
              aria-hidden="true"
            />
            <input
              id="location-address"
              ref="searchInput"
              aria-describedby="address-search-hint"
              :aria-controls="searchResults.length ? 'address-search-results' : undefined"
              v-model="searchQuery"
              type="search"
              :placeholder="t('addressPlaceholder')"
              autocomplete="off"
              maxlength="200"
              @input="editSearch"
            />
            <button
              type="submit"
              :disabled="searching || !searchQuery.trim()"
            >
              {{ t(searching ? 'addressSearching' : 'addressSearchButton') }}
            </button>
          </div>
          <p
            id="address-search-hint"
            class="location-picker__search-hint"
          >
            {{ t('addressSearchHint') }}
          </p>
        </form>
        <p
          v-if="searching || searchMessage || searchResults.length"
          class="location-picker__search-message"
          role="status"
        >
          {{
            searching
              ? t('addressSearching')
              : searchMessage
                ? t(searchMessage)
                : `${t('addressResults')}: ${searchResults.length}`
          }}
        </p>
        <ul
          v-if="searchResults.length"
          id="address-search-results"
          class="location-picker__results"
          :aria-label="t('addressResults')"
        >
          <li
            v-for="result in searchResults"
            :key="result.id"
          >
            <button
              type="button"
              @click="selectAddress(result)"
            >
              <MapPin
                :size="17"
                aria-hidden="true"
              />
              <span>
                <strong>{{ result.name }}</strong>
                <small>{{ result.address }}</small>
              </span>
            </button>
          </li>
        </ul>
        <div class="location-picker__map-area">
          <div
            ref="mapElement"
            class="location-picker__map"
            role="region"
            :aria-label="t('locationMapLabel')"
          />
          <span
            class="location-picker__pin"
            aria-hidden="true"
          >
            <MapPin :size="36" />
          </span>
          <div class="location-picker__zoom">
            <button
              :aria-label="t('zoomIn')"
              :disabled="!mapReady"
              @click="map?.zoomIn()"
            >
              <Plus
                aria-hidden="true"
                :size="18"
              />
            </button>
            <button
              :aria-label="t('zoomOut')"
              :disabled="!mapReady"
              @click="map?.zoomOut()"
            >
              <Minus
                aria-hidden="true"
                :size="18"
              />
            </button>
          </div>
          <p
            v-if="mapLoading || mapUnavailable"
            class="location-picker__map-message"
            role="status"
          >
            {{ t(mapUnavailable ? 'locationMapUnavailable' : 'mapLoading') }}
          </p>
        </div>
        <p class="location-picker__attribution">
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            © OpenStreetMap contributors
          </a>
          <span>·</span>
          <a
            href="https://photon.komoot.io/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Photon
          </a>
        </p>

        <form
          novalidate
          @submit.prevent="applyLocation"
        >
          <fieldset class="location-picker__coordinates">
            <legend>{{ t('coordinateInput') }}</legend>
            <div class="location-picker__fields">
              <label>
                <span>{{ t('latitude') }}</span>
                <input
                  v-model="latitude"
                  type="number"
                  inputmode="decimal"
                  min="-90"
                  max="90"
                  step="any"
                  :aria-invalid="Boolean(validationMessage)"
                  :aria-describedby="validationMessage ? 'location-picker-error' : undefined"
                  @change="updateMapCenter"
                />
              </label>
              <label>
                <span>{{ t('longitude') }}</span>
                <input
                  v-model="longitude"
                  type="number"
                  inputmode="decimal"
                  min="-180"
                  max="180"
                  step="any"
                  :aria-invalid="Boolean(validationMessage)"
                  :aria-describedby="validationMessage ? 'location-picker-error' : undefined"
                  @change="updateMapCenter"
                />
              </label>
            </div>
          </fieldset>
          <p
            v-if="validationMessage"
            id="location-picker-error"
            class="location-picker__error"
            role="alert"
          >
            {{ t(validationMessage) }}
          </p>
          <button
            ref="applyButton"
            class="location-picker__apply"
            type="submit"
          >
            <MapPin
              aria-hidden="true"
              :size="16"
            />
            {{ t('applyLocation') }}
          </button>
        </form>
      </div>
    </div>
  </dialog>
</template>
