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
    <span
      v-for="(cell, index) in cells"
      :key="index"
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
  </span>
</template>

<style lang="scss">
.split-flap {
  --flap-width: 23px;
  --flap-height: 36px;
  --flap-font: 26px;
  display: inline-flex;
  gap: 3px;
  vertical-align: middle;
  white-space: nowrap;

  &__cell {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--flap-width);
    height: var(--flap-height);
    flex-shrink: 0;
    overflow: hidden;
    border: 1px solid #020711;
    border-radius: 2px;
    background: linear-gradient(#16202c 0 49%, #0d1520 51% 100%);
    box-shadow:
      0 1px 0 #ffffff0a,
      inset 0 1px 1px #ffffff09;
    color: #f0f0e7;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: var(--flap-font);
    font-weight: 450;
    line-height: var(--flap-height);
    perspective: 140px;
  }

  &__character {
    position: relative;
  }

  &__leaf {
    position: absolute;
    inset: 0;
    background: linear-gradient(#16202c, #131c28);
    text-align: center;
    clip-path: inset(0 0 50% 0);
    backface-visibility: hidden;
    transform-origin: center;
    animation: flap-turn 85ms ease-in forwards;
  }

  &__seam {
    position: absolute;
    z-index: 2;
    top: calc(50% - 1px);
    left: 0;
    width: 100%;
    height: 2px;
    background: #050b13d9;
    box-shadow: 0 1px 0 #ffffff06;
  }
}

@keyframes flap-turn {
  from {
    transform: rotateX(0);
  }
  to {
    transform: rotateX(-180deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .split-flap__leaf {
    display: none;
  }
}
</style>
