<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  text: { type: [String, Number], default: '' },
  cycle: { type: Number, default: 0 },
})

const target = computed(() => Array.from(String(props.text).toUpperCase()))
const cells = ref(
  target.value.map((value) => ({ value, previous: value, frame: 0, moving: false })),
)
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
let timer
let motionPreference
let mounted = false

function showText() {
  clearInterval(timer)
  cells.value = target.value.map((value) => ({ value, previous: value, frame: 0, moving: false }))
}

function turnFlaps() {
  clearInterval(timer)
  if (!mounted || motionPreference?.matches) return showText()

  const previous = cells.value.map((cell) => cell.value)
  const next = [...target.value]
  const start = performance.now()
  cells.value = next.map((value, index) => ({
    value: previous[index] || ' ',
    previous: ' ',
    frame: 0,
    moving: false,
  }))

  timer = setInterval(() => {
    const elapsed = performance.now() - start
    cells.value = next.map((value, index) => {
      const step = Math.floor((elapsed - index * 26) / 85)
      const cell = cells.value[index]
      if (step < 0) return cell
      if (step >= 6) return { ...cell, value, moving: false }
      const character =
        step === 5 || value === ' '
          ? value
          : alphabet[(value.codePointAt(0) + step * 7 + index) % alphabet.length]
      return { value: character, previous: cell.value, frame: cell.frame + 1, moving: true }
    })
    if (elapsed > 6 * 85 + next.length * 26) showText()
  }, 85)
}

watch([() => props.text, () => props.cycle], turnFlaps)
onMounted(() => {
  mounted = true
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionPreference.addEventListener('change', showText)
  turnFlaps()
})
onUnmounted(() => {
  clearInterval(timer)
  motionPreference?.removeEventListener('change', showText)
})
</script>

<template>
  <span
    class="split-flap"
    role="img"
    :aria-label="String(text)"
  >
    <template
      v-for="(cell, index) in cells"
      :key="index"
    >
      <span
        v-if="target[index] === ' '"
        class="split-flap__space"
        aria-hidden="true"
      />
      <span
        v-else
        class="split-flap__cell"
        aria-hidden="true"
      >
        <span class="split-flap__character">{{ cell.value === ' ' ? '\u00a0' : cell.value }}</span>
        <span
          v-if="cell.moving"
          :key="cell.frame"
          class="split-flap__leaf"
        >
          {{ cell.previous }}
        </span>
        <span class="split-flap__seam" />
      </span>
    </template>
  </span>
</template>
