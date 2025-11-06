// WFRP4e - No Defender Damage (RAW)
// Purpose: if the DEFENDER wins an opposed test, no damage should be applied
// unless the defender has a talent or effect that allows it (e.g. Counter-Attack, Riposte).

Hooks.once("ready", () => {
  const TALENT_NAMES = [
    "Counter-Attack",
    "Riposte",
    "Controattacco",
    "Ritorsione"
  ];

  function hasCounterTalent(actor) {
    try {
      return actor?.items?.some(it =>
        it.type === "talent" && TALENT_NAMES.map(n => n.toLowerCase()).includes((it.name || "").toLowerCase())
      ) || false;
    } catch (e) {
      console.warn("wfrp4e-no-defender-damage: error checking talents:", e);
      return false;
    }
  }

  // Try using the system-level hook first, if available (newer versions of WFRP4e)
  const hasSystemHook = Hooks.events?.["wfrp4e:preApplyOpposedResult"];
  if (hasSystemHook) {
    Hooks.on("wfrp4e:preApplyOpposedResult", (data) => {
      try {
        const res = data?.result || {};
        if (res.winner === "defender") {
          const defender = res.defender?.document || res.defender || null;
          if (!hasCounterTalent(defender)) {
            res.damageFromDefender = 0;
            if (Array.isArray(res.additionalDamageFromDefender))
              res.additionalDamageFromDefender = [];
          }
        }
      } catch (e) {
        console.warn("wfrp4e-no-defender-damage: error in preApplyOpposedResult:", e);
      }
    });
    console.info("wfrp4e-no-defender-damage: active via hook wfrp4e:preApplyOpposedResult");
    return;
  }

  // Fallback: monkey-patch the internal OpposedWFRP class if hook not available
  const OpposedClass = globalThis.OpposedWFRP || globalThis.Opposed || null;
  const applyFnName = "_calculateOpposedResult"; // check your version if name differs

  if (OpposedClass && typeof OpposedClass.prototype[applyFnName] === "function") {
    const _orig = OpposedClass.prototype[applyFnName];

    OpposedClass.prototype[applyFnName] = async function(...args) {
      const result = await _orig.apply(this, args);

      try {
        const res = this?.result || result || {};
        if (res.winner === "defender") {
          const defender = this?.defender?.document || this?.defender || res.defender || null;
          if (!hasCounterTalent(defender)) {
            if ("damageFromDefender" in res) res.damageFromDefender = 0;
            if (Array.isArray(res.additionalDamageFromDefender))
              res.additionalDamageFromDefender = [];
          }
        }
      } catch (e) {
        console.warn("wfrp4e-no-defender-damage: error in monkey-patch:", e);
      }

      return result;
    };

    console.info("wfrp4e-no-defender-damage: active via monkey-patch on OpposedWFRP");
  } else {
    console.warn("wfrp4e-no-defender-damage: Could not find OpposedWFRP or target method. Update names for your system version.");
  }
});
