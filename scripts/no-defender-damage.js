// RIPOSTE — Opposed Defender effect
// Allows a defender who wins an opposed test to immediately counter-attack
// if their weapon has the "Fast" quality. Uses per round = talent rank.

try {
  const ot = args?.opposedTest;
  if (!ot) return;

  const lower = s => String(s ?? "").trim().toLowerCase();
  if (lower(ot?.result?.winner) !== "defender") return;     // must win
  if (!ot?.attackerTest?.result?.damage) return;            // nothing to riposte

  // Actor and weapon used in defense
  const actor = ot?.defender?.document || ot?.defender?.actor || args?.actor || null;
  const weapon = ot?.defenderTest?.weapon || ot?.defender?.weapon || ot?.defenderWeapon || null;

  // Rank (number of advances in the talent)
  const rank =
    Number(this?.item?.system?.advances?.value ??
           this?.item?.system?.advances ??
           this?.item?.system?.level ?? 1) || 1;

  // Check "Fast" quality
  const hasFast = w => {
    if (!w) return false;
    const sys = w.system || w.data?.data || {};
    const raw = sys?.qualities?.value ?? sys?.qualities ?? [];
    const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
    return arr.some(q => lower(q?.name) === "fast");
  };
  if (!hasFast(weapon)) return;

  // Per-round limiter
  const combat = game.combat;
  const FLAG_SCOPE = "wfrp4e-riposte";
  const FLAG_KEY = "uses";
  if (combat && actor) {
    const round = combat.round;
    let data = await actor.getFlag(FLAG_SCOPE, FLAG_KEY);
    if (!data || typeof data !== "object") data = { round: null, count: 0 };
    if (data.round !== round) { data.round = round; data.count = 0; }
    if (data.count >= rank) return; // limit reached
    await ot.swap(this.effect?.name || "Riposte");
    data.count++;
    await actor.setFlag(FLAG_SCOPE, FLAG_KEY, data);
  } else {
    // Outside combat: no limit
    await ot.swap(this.effect?.name || "Riposte");
  }

} catch (err) {
  console.warn("Riposte effect error:", err);
}
