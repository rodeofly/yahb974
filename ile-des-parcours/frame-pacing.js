// Pace rendering independently from simulation time. Balanced/high follow RAF;
// eco keeps a 30 Hz deadline without quantising it to the display refresh rate.
const ECO_INTERVAL_MS = 1000 / 30;
const MAX_DT_SECONDS = 0.075;
const CLOCK_EPSILON_MS = 1e-6;

export function createFramePacer() {
  let lastSeenAt = null, lastAcceptedAt = null, nextEcoAt = null, eco = false;

  function reset() {
    lastSeenAt = lastAcceptedAt = nextEcoAt = null;
    eco = false;
  }

  function step(now, { quality = 'balanced' } = {}) {
    if (!Number.isFinite(now)) return { render: false, dt: 0 };
    // RAF is monotonic. A replaced clock is a new start, never negative physics.
    if (lastSeenAt !== null && now < lastSeenAt) reset();
    lastSeenAt = now;
    const requestedEco = quality === 'eco';
    const newSchedule = lastAcceptedAt === null || requestedEco !== eco;

    if (!newSchedule && eco && now + CLOCK_EPSILON_MS < nextEcoAt) {
      return { render: false, dt: 0 };
    }

    // A deadline corrected for display cadence is NOT the last simulation time.
    const dt = lastAcceptedAt === null ? 0 : Math.min(MAX_DT_SECONDS, Math.max(0, (now - lastAcceptedAt) / 1000));
    lastAcceptedAt = now;
    eco = requestedEco;
    if (!eco) nextEcoAt = null;
    else if (newSchedule) nextEcoAt = now + ECO_INTERVAL_MS;
    else {
      // Skip missed deadlines after a stall, retaining the original phase.
      const periods = Math.max(1, Math.floor((now - nextEcoAt + CLOCK_EPSILON_MS) / ECO_INTERVAL_MS) + 1);
      nextEcoAt += periods * ECO_INTERVAL_MS;
    }
    return { render: true, dt };
  }

  return { step, reset };
}
