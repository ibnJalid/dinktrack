import React, { useState, useEffect, useMemo, useRef } from "react";
import { Undo2, Trophy, Users, RotateCw, Edit3, Check, X, Flag, Camera, Smile, Trash2, Menu, RefreshCcw, ArrowLeft, Shuffle } from "lucide-react";

// ---------- Persistent state ----------
const STATE_KEY = "pb:state:v3";

const defaultState = () => ({
  players: [
    { id: "p1", name: "Player 1", avatar: null }, // avatar: null | { type: 'photo'|'emoji', value: string }
    { id: "p2", name: "Player 2", avatar: null },
    { id: "p3", name: "Player 3", avatar: null },
    { id: "p4", name: "Player 4", avatar: null },
  ],
  matchTarget: 11,
  currentMatch: {
    id: null,
    scores: { A: 0, B: 0 },
    playerPoints: {},
    events: [],
    teamA: ["p1", "p2"],
    teamB: ["p3", "p4"],
    startedAt: null,
  },
  matches: [],
});

function loadState() {
  try {
    const stored = localStorage.getItem(STATE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (!parsed.matchTarget) parsed.matchTarget = 11;
      parsed.players = parsed.players.map(p => ({ avatar: null, ...p }));
      return parsed;
    }
  } catch (e) {}
  return defaultState();
}

function saveState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
  catch (e) { console.error("save failed", e); }
}

// ---------- Streak detection ----------
// Returns { player: id, count: N } if a single player has scored 3+ in a row, else null
function getOnFireStreak(events) {
  if (!events || events.length < 3) return null;
  const last = events[events.length - 1].player;
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].player === last) count++;
    else break;
  }
  return count >= 3 ? { player: last, count } : null;
}

// ---------- Match duration formatter ----------
function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ---------- Image helper ----------
function resizeImageToDataUrl(file, size = 200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Helpers ----------
const teamKey = (ids) => [...ids].sort().join("+");

const computeStats = (state) => {
  const playerById = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const playerStats = {};
  state.players.forEach((p) => {
    playerStats[p.id] = { name: p.name, points: 0, wins: 0, losses: 0, matches: 0 };
  });
  const comboStats = {};
  state.matches.forEach((m) => {
    const aKey = teamKey(m.teamA);
    const bKey = teamKey(m.teamB);
    if (!comboStats[aKey]) comboStats[aKey] = { ids: m.teamA, wins: 0, losses: 0, played: 0 };
    if (!comboStats[bKey]) comboStats[bKey] = { ids: m.teamB, wins: 0, losses: 0, played: 0 };
    comboStats[aKey].played++; comboStats[bKey].played++;
    if (m.winner === "A") {
      comboStats[aKey].wins++; comboStats[bKey].losses++;
      m.teamA.forEach((id) => playerStats[id] && playerStats[id].wins++);
      m.teamB.forEach((id) => playerStats[id] && playerStats[id].losses++);
    } else {
      comboStats[bKey].wins++; comboStats[aKey].losses++;
      m.teamB.forEach((id) => playerStats[id] && playerStats[id].wins++);
      m.teamA.forEach((id) => playerStats[id] && playerStats[id].losses++);
    }
    [...m.teamA, ...m.teamB].forEach((id) => playerStats[id] && playerStats[id].matches++);
    Object.entries(m.playerPoints || {}).forEach(([id, pts]) => {
      if (playerStats[id]) playerStats[id].points += pts;
    });
  });
  return { playerStats, comboStats, playerById };
};

const detectWin = (scores, target) => {
  const top = Math.max(scores.A, scores.B);
  const lead = Math.abs(scores.A - scores.B);
  if (top >= target && lead >= 2) return scores.A > scores.B ? "A" : "B";
  return null;
};

const detectMatchPoint = (scores, target) => {
  if (detectWin(scores, target)) return null;
  const wA = detectWin({ A: scores.A + 1, B: scores.B }, target);
  const wB = detectWin({ A: scores.A, B: scores.B + 1 }, target);
  if (wA && wB) return "both";
  if (wA) return "A";
  if (wB) return "B";
  return null;
};

const PAIRINGS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];

const FUN_EMOJIS = ["🎾", "🏓", "🏆", "⚡", "🔥", "💪", "⭐", "🚀", "🦄", "🐯", "🦁", "🐼", "🦊", "🐸", "🦅", "👑", "🤖", "😎", "🤩", "🥳", "🤪", "🦖", "🦸", "🧙", "🥷", "🧠", "👾", "🌶️"];

// ---------- Avatar ----------
function Avatar({ player, team, size = 80, ringWidth = 0 }) {
  const teamColor = team === "A" ? "var(--teamA)" : "var(--teamB)";
  const ringStyle = ringWidth ? { boxShadow: `0 0 0 ${ringWidth}px ${teamColor}` } : {};
  const baseStyle = {
    width: size, height: size, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden", flexShrink: 0,
    ...ringStyle,
  };
  if (player.avatar?.type === "photo") {
    return <img src={player.avatar.value} alt={player.name} style={{ ...baseStyle, objectFit: "cover", background: "white" }} />;
  }
  if (player.avatar?.type === "emoji") {
    return <div style={{ ...baseStyle, background: "white", fontSize: size * 0.55, lineHeight: 1 }}>{player.avatar.value}</div>;
  }
  const initials = (player.name || "?").split(/\s+/).map(s => s[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{
      ...baseStyle, background: "white", color: teamColor,
      fontFamily: "var(--font-display)", fontWeight: 800, fontSize: size * 0.36, letterSpacing: "-0.02em",
    }}>{initials}</div>
  );
}

// ---------- Modal ----------
function Modal({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", confirmTone = "primary", onConfirm, onCancel }) {
  if (!open) return null;
  const confirmBg = confirmTone === "danger" ? "var(--teamA)" : confirmTone === "primary" ? "var(--ink)" : "var(--accent)";
  const confirmColor = (confirmTone === "danger" || confirmTone === "primary") ? "var(--bg)" : "var(--ink)";
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(20,16,12,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 440, background: "var(--bg-card)",
        borderRadius: 18, padding: "22px 20px 20px", border: "1px solid var(--line)",
      }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--ink)", marginBottom: 8 }}>{title}</div>
        {message && <div style={{ fontSize: 14, color: "var(--ink-muted)", lineHeight: 1.5, marginBottom: 18 }}>{message}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: 12, borderRadius: 12, border: "1px solid var(--line)",
            background: "transparent", color: "var(--ink)", fontWeight: 600, fontSize: 14, cursor: "pointer",
            fontFamily: "var(--font-display)",
          }}>{cancelLabel}</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: 12, borderRadius: 12, border: "none",
            background: confirmBg, color: confirmColor, fontWeight: 700, fontSize: 14, cursor: "pointer",
            fontFamily: "var(--font-display)",
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- App ----------
export default function App() {
  const [state, setState] = useState(null);
  const [view, setView] = useState("court"); // court | menu
  const [menuTab, setMenuTab] = useState("stats"); // stats | roster
  const [pairingIdx, setPairingIdx] = useState(0);
  const [editingPlayerId, setEditingPlayerId] = useState(null);
  const [pulse, setPulse] = useState(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [swapSelectedId, setSwapSelectedId] = useState(null); // playerId currently picked up for swap
  const [isPortrait, setIsPortrait] = useState(() => typeof window !== "undefined" && window.innerHeight > window.innerWidth);

  useEffect(() => {
    setState(loadState());
  }, []);

  useEffect(() => { if (state) saveState(state); }, [state]);

  useEffect(() => {
    const onResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  if (!state) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4EFE6", color: "#1A1612" }}>Loading…</div>;
  }

  const { players, currentMatch, matchTarget } = state;
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));
  const teamA = currentMatch.teamA.map((id) => playerById[id]).filter(Boolean);
  const teamB = currentMatch.teamB.map((id) => playerById[id]).filter(Boolean);
  const winner = detectWin(currentMatch.scores, matchTarget);
  const matchPointTeam = detectMatchPoint(currentMatch.scores, matchTarget);
  const fireStreak = getOnFireStreak(currentMatch.events);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  // ---- Match actions ----
  const scorePoint = (playerId) => {
    const team = currentMatch.teamA.includes(playerId) ? "A" : "B";
    setState((s) => ({
      ...s,
      currentMatch: {
        ...s.currentMatch,
        id: s.currentMatch.id || `m_${Date.now()}`,
        startedAt: s.currentMatch.startedAt || Date.now(),
        scores: { ...s.currentMatch.scores, [team]: s.currentMatch.scores[team] + 1 },
        playerPoints: { ...s.currentMatch.playerPoints, [playerId]: (s.currentMatch.playerPoints[playerId] || 0) + 1 },
        events: [...s.currentMatch.events, { player: playerId, team }],
      },
    }));
    setPulse(playerId);
    setTimeout(() => setPulse(null), 380);
  };

  const undo = () => {
    if (currentMatch.events.length === 0) return;
    const last = currentMatch.events[currentMatch.events.length - 1];
    setState((s) => ({
      ...s,
      currentMatch: {
        ...s.currentMatch,
        scores: { ...s.currentMatch.scores, [last.team]: Math.max(0, s.currentMatch.scores[last.team] - 1) },
        playerPoints: { ...s.currentMatch.playerPoints, [last.player]: Math.max(0, (s.currentMatch.playerPoints[last.player] || 0) - 1) },
        events: s.currentMatch.events.slice(0, -1),
      },
    }));
  };

  const performEndMatch = () => {
    const w = currentMatch.scores.A > currentMatch.scores.B ? "A" : currentMatch.scores.B > currentMatch.scores.A ? "B" : null;
    if (!w) { showToast("Tied — play one more point"); return; }
    const completed = {
      id: currentMatch.id || `m_${Date.now()}`,
      teamA: [...currentMatch.teamA], teamB: [...currentMatch.teamB],
      scoreA: currentMatch.scores.A, scoreB: currentMatch.scores.B,
      winner: w, playerPoints: { ...currentMatch.playerPoints },
      finishedAt: Date.now(), target: matchTarget,
    };
    setState((s) => ({
      ...s,
      matches: [completed, ...s.matches],
      currentMatch: { ...defaultState().currentMatch, teamA: s.currentMatch.teamA, teamB: s.currentMatch.teamB },
    }));
    showToast(`Saved · Team ${w === "A" ? "1" : "2"} wins ${completed.scoreA}–${completed.scoreB}`);
  };

  const endMatch = () => {
    if (currentMatch.scores.A === 0 && currentMatch.scores.B === 0) { showToast("No points yet"); return; }
    setModal({
      title: "End and save match?",
      message: `Final score — Team 1: ${currentMatch.scores.A}, Team 2: ${currentMatch.scores.B}. This will be saved to your stats.`,
      confirmLabel: "Save match", confirmTone: "primary",
      onConfirm: () => { setModal(null); performEndMatch(); },
    });
  };

  const resetCurrent = () => {
    if (currentMatch.events.length === 0) return;
    setModal({
      title: "Discard current match?",
      message: "All points from this match will be lost.",
      confirmLabel: "Discard", confirmTone: "danger",
      onConfirm: () => {
        setModal(null);
        setState((s) => ({
          ...s,
          currentMatch: { ...defaultState().currentMatch, teamA: s.currentMatch.teamA, teamB: s.currentMatch.teamB },
        }));
      },
    });
  };

  const rotatePartners = () => {
    const apply = () => {
      const next = (pairingIdx + 1) % PAIRINGS.length;
      setPairingIdx(next);
      const ids = players.map((p) => p.id);
      const [aIdx, bIdx] = PAIRINGS[next];
      setState((s) => ({
        ...s,
        currentMatch: { ...defaultState().currentMatch, teamA: aIdx.map((i) => ids[i]), teamB: bIdx.map((i) => ids[i]) },
      }));
    };
    if (currentMatch.events.length > 0) {
      setModal({
        title: "Rotate partners?",
        message: "Match in progress. Current score will reset.",
        confirmLabel: "Rotate", confirmTone: "danger",
        onConfirm: () => { setModal(null); apply(); },
      });
    } else { apply(); }
  };

  const setMatchTarget = (target) => setState((s) => ({ ...s, matchTarget: target }));

  const resetAllData = () => {
    setModal({
      title: "Reset all stats?",
      message: "This will clear ALL match history and individual point counts. Player names and photos are kept. This can't be undone.",
      confirmLabel: "Reset everything",
      confirmTone: "danger",
      onConfirm: () => {
        setModal(null);
        setState((s) => ({
          ...s,
          matches: [],
          currentMatch: {
            ...defaultState().currentMatch,
            teamA: s.currentMatch.teamA,
            teamB: s.currentMatch.teamB,
          },
        }));
        showToast("All stats cleared");
      },
    });
  };

  // ---- Swap players (preserves team scores; personal points travel with the player) ----
  const swapPlayers = (idA, idB) => {
    if (!idA || !idB || idA === idB) return;
    setState((s) => {
      const swap = (arr) => arr.map((id) => (id === idA ? idB : id === idB ? idA : id));
      return {
        ...s,
        currentMatch: {
          ...s.currentMatch,
          teamA: swap(s.currentMatch.teamA),
          teamB: swap(s.currentMatch.teamB),
        },
      };
    });
  };

  const onPlayerTap = (playerId) => {
    if (swapSelectedId) {
      if (swapSelectedId === playerId) {
        setSwapSelectedId(null); // tapping selected = cancel
      } else {
        swapPlayers(swapSelectedId, playerId);
        setSwapSelectedId(null);
        showToast("Swapped");
      }
    } else {
      scorePoint(playerId);
    }
  };

  const onPlayerLongPress = (playerId) => {
    setSwapSelectedId(playerId);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(40);
  };

  const enterSwapModeEmpty = () => {
    // Tapping the swap button with no selection: just enable mode (user picks who first)
    if (swapSelectedId) setSwapSelectedId(null);
    else showToast("Tap a player to pick them up");
  };

  const cancelSwap = () => setSwapSelectedId(null);

  const updatePlayer = (id, patch) => {
    setState((s) => ({ ...s, players: s.players.map((p) => p.id === id ? { ...p, ...patch } : p) }));
  };

  const lastEvent = currentMatch.events[currentMatch.events.length - 1];
  const lastEventLabel = lastEvent ? playerById[lastEvent.player]?.name : null;

  return (
    <div style={{ minHeight: "100vh", height: "100vh", background: (isPortrait && view === "court") ? "#FFFFFF" : "var(--bg)", color: "var(--ink)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <style>{`
        :root {
          --bg: #F4EFE6; --bg-card: #FBF7EE; --ink: #1A1612; --ink-muted: #6B6359;
          --line: #DCD3C2; --teamA: #D63B26; --teamA-soft: #F7DBD3; --teamA-deep: #4A1B0C;
          --teamB: #0F4C4C; --teamB-soft: #C7D9D9; --teamB-deep: #04342C; --accent: #F2D74E;
          --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
          --font-body: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
          --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
        }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: var(--font-body); }
        button { font-family: inherit; cursor: pointer; }
        @keyframes pulse-tile { 0%{transform:scale(1)} 35%{transform:scale(1.04)} 100%{transform:scale(1)} }
        @keyframes float-pt-anim { 0%{opacity:0;transform:translate(-50%,0) scale(0.8)} 25%{opacity:1;transform:translate(-50%,-20px) scale(1)} 100%{opacity:0;transform:translate(-50%,-80px) scale(1.1)} }
        @keyframes mp-pulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
        .pulse-tile { animation: pulse-tile 380ms ease-out; }
        .float-pt { animation: float-pt-anim 800ms ease-out forwards; }
        .mp-pulse { animation: mp-pulse 1.4s ease-in-out infinite; }
        /* Suppress tap highlight */
        button { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {view === "court" ? (
        isPortrait ? (
          <PortraitCourtView
            teamA={teamA} teamB={teamB} scores={currentMatch.scores}
            playerPoints={currentMatch.playerPoints} pulse={pulse}
            winner={winner} matchPointTeam={matchPointTeam}
            matchTarget={matchTarget}
            eventCount={currentMatch.events.length}
            lastEventLabel={lastEventLabel}
            onTap={onPlayerTap} onLongPress={onPlayerLongPress}
            swapSelectedId={swapSelectedId}
            onSwapButton={enterSwapModeEmpty}
            onCancelSwap={cancelSwap}
            playerById={playerById}
            onUndo={undo} onEnd={endMatch}
            onMenu={() => setView("menu")}
            fireStreak={fireStreak}
            onReset={resetCurrent}
            startedAt={currentMatch.startedAt}
          />
        ) : (
          <CourtView
            teamA={teamA} teamB={teamB} scores={currentMatch.scores}
            playerPoints={currentMatch.playerPoints} pulse={pulse}
            winner={winner} matchPointTeam={matchPointTeam}
            matchTarget={matchTarget}
            eventCount={currentMatch.events.length}
            lastEventLabel={lastEventLabel}
            onTap={onPlayerTap} onLongPress={onPlayerLongPress}
            swapSelectedId={swapSelectedId}
            onSwapButton={enterSwapModeEmpty}
            onCancelSwap={cancelSwap}
            playerById={playerById}
            onUndo={undo} onEnd={endMatch}
            onMenu={() => setView("menu")}
            fireStreak={fireStreak}
            onReset={resetCurrent}
            startedAt={currentMatch.startedAt}
          />
        )
      ) : (
        <MenuView
          state={state} menuTab={menuTab} setMenuTab={setMenuTab}
          onBack={() => setView("court")}
          onRotate={rotatePartners} onReset={resetCurrent}
          onResetAll={resetAllData}
          matchTarget={matchTarget} setMatchTarget={setMatchTarget}
          editingPlayerId={editingPlayerId} setEditingPlayerId={setEditingPlayerId}
          updatePlayer={updatePlayer}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink)", color: "var(--bg)", padding: "10px 18px", borderRadius: 999,
          fontSize: 13, fontWeight: 600, fontFamily: "var(--font-display)",
          zIndex: 90, maxWidth: 420, textAlign: "center",
        }}>{toast}</div>
      )}

      <Modal open={!!modal} title={modal?.title} message={modal?.message}
        confirmLabel={modal?.confirmLabel} confirmTone={modal?.confirmTone}
        onConfirm={modal?.onConfirm} onCancel={() => setModal(null)} />
    </div>
  );
}

// ---------- Court View (landscape-optimized) ----------
function CourtView({ teamA, teamB, scores, playerPoints, pulse, winner, matchPointTeam, matchTarget, eventCount, lastEventLabel, onTap, onLongPress, swapSelectedId, onSwapButton, onCancelSwap, playerById, onUndo, onEnd, onMenu, fireStreak, onReset, startedAt }) {
  const inSwapMode = !!swapSelectedId;
  const selectedName = swapSelectedId ? playerById[swapSelectedId]?.name : null;
  return (
    <>
      {/* Top thin header — switches into swap-mode banner when a player is picked up */}
      <div style={{
        flexShrink: 0, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid var(--line)",
        background: inSwapMode ? "var(--accent)" : "var(--bg)",
        transition: "background 200ms ease",
      }}>
        {inSwapMode ? (
          <>
            <button onClick={onCancelSwap} style={{
              background: "transparent", border: "none", padding: 6,
              display: "flex", alignItems: "center", gap: 6, color: "var(--ink)",
            }}>
              <X size={18} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Cancel</span>
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", letterSpacing: "0.02em" }}>
              Swap <span style={{ textDecoration: "underline" }}>{selectedName}</span> with another player…
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={onMenu} style={{
                background: "transparent", border: "none", padding: 6,
                display: "flex", alignItems: "center", gap: 6, color: "var(--ink-muted)",
              }}>
                <Menu size={18} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Menu</span>
              </button>
              <button onClick={onReset} disabled={eventCount === 0} style={{
                background: "transparent", border: "none", padding: 6,
                display: "flex", alignItems: "center", color: "var(--ink-muted)",
                opacity: eventCount === 0 ? 0.3 : 1,
                cursor: eventCount === 0 ? "default" : "pointer",
              }} aria-label="Reset points">
                <RefreshCcw size={16} />
              </button>
            </div>
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Game · to {matchTarget} · {eventCount} pt{eventCount === 1 ? "" : "s"}
            </div>
          </>
        )}
      </div>

      {/* Main court — grid: 4 corners + dominant center column */}
      <div style={{
        flex: 1, position: "relative",
        display: "grid",
        gridTemplateColumns: "1fr clamp(360px, 52vw, 540px) 1fr",
        gridTemplateRows: "1fr 1fr",
        gridTemplateAreas: `"tl center tr" "bl center br"`,
        gap: 8, padding: 8, minHeight: 0, background: "var(--bg)",
      }}>
        {teamA[0] && (
          <div style={{ gridArea: "tl", minHeight: 0, display: "flex" }}>
            <PlayerTile player={teamA[0]} team="A" points={playerPoints[teamA[0].id] || 0}
              pulsing={pulse === teamA[0].id}
              onTap={() => onTap(teamA[0].id)} onLongPress={() => onLongPress(teamA[0].id)}
              isSwapSelected={swapSelectedId === teamA[0].id}
              isSwapTarget={swapSelectedId && swapSelectedId !== teamA[0].id}
              fireStreak={fireStreak} />
          </div>
        )}
        {teamA[1] && (
          <div style={{ gridArea: "bl", minHeight: 0, display: "flex" }}>
            <PlayerTile player={teamA[1]} team="A" points={playerPoints[teamA[1].id] || 0}
              pulsing={pulse === teamA[1].id}
              onTap={() => onTap(teamA[1].id)} onLongPress={() => onLongPress(teamA[1].id)}
              isSwapSelected={swapSelectedId === teamA[1].id}
              isSwapTarget={swapSelectedId && swapSelectedId !== teamA[1].id}
              fireStreak={fireStreak} />
          </div>
        )}
        {teamB[0] && (
          <div style={{ gridArea: "tr", minHeight: 0, display: "flex" }}>
            <PlayerTile player={teamB[0]} team="B" points={playerPoints[teamB[0].id] || 0}
              pulsing={pulse === teamB[0].id}
              onTap={() => onTap(teamB[0].id)} onLongPress={() => onLongPress(teamB[0].id)}
              isSwapSelected={swapSelectedId === teamB[0].id}
              isSwapTarget={swapSelectedId && swapSelectedId !== teamB[0].id}
              fireStreak={fireStreak} />
          </div>
        )}
        {teamB[1] && (
          <div style={{ gridArea: "br", minHeight: 0, display: "flex" }}>
            <PlayerTile player={teamB[1]} team="B" points={playerPoints[teamB[1].id] || 0}
              pulsing={pulse === teamB[1].id}
              onTap={() => onTap(teamB[1].id)} onLongPress={() => onLongPress(teamB[1].id)}
              isSwapSelected={swapSelectedId === teamB[1].id}
              isSwapTarget={swapSelectedId && swapSelectedId !== teamB[1].id}
              fireStreak={fireStreak} />
          </div>
        )}

        <div style={{ gridArea: "center", minHeight: 0, display: "flex" }}>
          <CenterColumn scores={scores} matchPointTeam={matchPointTeam} />
        </div>

        {/* Victory: full match summary */}
        {winner && (
          <MatchSummaryCard
            scores={scores} playerPoints={playerPoints}
            teamA={teamA} teamB={teamB} winner={winner}
            startedAt={startedAt} matchTarget={matchTarget}
            onUndo={onUndo} onSaveAndPlayAgain={onEnd}
          />
        )}
      </div>

      {/* Slim bottom action bar */}
      <div style={{
        flexShrink: 0, padding: "6px 10px 8px", display: "flex", gap: 6,
        borderTop: "1px solid var(--line)", background: "var(--bg-card)",
      }}>
        <button onClick={onUndo} disabled={eventCount === 0 || inSwapMode} style={{
          flex: 2, padding: "8px 12px", borderRadius: 9,
          border: "1px solid var(--line)",
          background: eventCount > 0 && !inSwapMode ? "var(--accent)" : "var(--bg-card)",
          color: eventCount > 0 && !inSwapMode ? "var(--ink)" : "var(--ink-muted)",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          opacity: eventCount > 0 && !inSwapMode ? 1 : 0.45,
          minWidth: 0,
        }}>
          <Undo2 size={13} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Undo{lastEventLabel ? ` · ${lastEventLabel}` : ""}
          </span>
        </button>

        <button onClick={inSwapMode ? onCancelSwap : onSwapButton} style={{
          flex: 1, padding: "8px 10px", borderRadius: 9,
          border: inSwapMode ? "1px solid var(--ink)" : "1px solid var(--line)",
          background: inSwapMode ? "var(--ink)" : "var(--bg-card)",
          color: inSwapMode ? "var(--bg)" : "var(--ink)",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        }} aria-label="Swap players">
          <Shuffle size={13} />
          <span>{inSwapMode ? "Cancel" : "Swap"}</span>
        </button>

        <button onClick={onEnd} disabled={inSwapMode} style={{
          flex: 1, padding: "8px 10px", borderRadius: 9,
          border: "1px solid var(--ink)", background: "var(--ink)", color: "var(--bg)",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 12,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          opacity: inSwapMode ? 0.4 : 1,
        }}>
          <Flag size={12} />
          <span>End</span>
        </button>
      </div>
    </>
  );
}

// ---------- Center Column (massive score + actions) ----------
function CenterColumn({ scores, matchPointTeam }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-card)",
      border: "1px solid var(--line)", borderRadius: 18,
      display: "flex", flexDirection: "column", justifyContent: "center",
      padding: "10px 14px",
      minHeight: 0,
    }}>
      <div style={{ flexShrink: 0 }}>
        <ScoreNumber value={scores.A} color="var(--teamA)" matchPoint={matchPointTeam === "A" || matchPointTeam === "both"} label="Team 1" />
      </div>
      <div style={{ height: 3, background: "var(--ink)", opacity: 0.18, margin: "8px 8px", flexShrink: 0, borderRadius: 2 }} />
      <div style={{ flexShrink: 0 }}>
        <ScoreNumber value={scores.B} color="var(--teamB)" matchPoint={matchPointTeam === "B" || matchPointTeam === "both"} label="Team 2" />
      </div>
    </div>
  );
}

function ScoreNumber({ value, color, matchPoint, label }) {
  return (
    <div style={{ textAlign: "center", lineHeight: 1, position: "relative" }}>
      <div style={{ fontSize: 10, color, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 800, marginBottom: 4 }}>
        {label}
        {matchPoint && (
          <span className="mp-pulse" style={{
            marginLeft: 6, fontSize: 9, fontWeight: 800, letterSpacing: "0.12em",
            background: color, color: "var(--bg-card)", padding: "1px 6px", borderRadius: 999,
          }}>Match pt</span>
        )}
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontWeight: 700,
        fontSize: "clamp(96px, 36vh, 200px)", color: "var(--ink)",
        letterSpacing: "-0.06em", lineHeight: 0.82,
      }}>
        {String(value).padStart(2, "0")}
      </div>
    </div>
  );
}

// ---------- Player Tile (corner-optimized: name dominant, avatar secondary) ----------
function PlayerTile({ player, team, points, pulsing, onTap, onLongPress, isSwapSelected, isSwapTarget, fireStreak }) {
  const teamColor = team === "A" ? "var(--teamA)" : "var(--teamB)";
  const teamSoft = team === "A" ? "var(--teamA-soft)" : "var(--teamB-soft)";
  const isOnFire = fireStreak?.player === player.id;
  const streakCount = isOnFire ? fireStreak.count : 0;

  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);
  const startPos = useRef(null);

  const clearTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (e) => {
    longPressFired.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      onLongPress();
    }, 500);
  };

  const handlePointerMove = (e) => {
    if (!startPos.current || !longPressTimer.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimer();
  };

  const handlePointerUp = () => {
    clearTimer();
    startPos.current = null;
    if (!longPressFired.current) onTap();
  };

  const handlePointerCancel = () => {
    clearTimer();
    startPos.current = null;
    longPressFired.current = false;
  };

  // Visual states
  let ringColor = teamColor;
  let ringWidth = 1.5;
  let bg = teamSoft;
  let topLabel = "Tap to score";
  let topLabelColor = teamColor;

  if (pulsing) ringWidth = 4;
  if (isOnFire) {
    topLabel = `🔥 On fire ×${streakCount}`;
    topLabelColor = "#FF4500";
    ringColor = "#FF4500";
    ringWidth = 3;
  }
  if (isSwapSelected) {
    ringColor = "var(--ink)";
    ringWidth = 4;
    bg = "var(--accent)";
    topLabel = "Picked up · tap another";
    topLabelColor = "var(--ink)";
  } else if (isSwapTarget) {
    topLabel = "Tap to swap here";
    topLabelColor = "var(--ink-muted)";
  }

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={pulsing ? "pulse-tile" : ""}
      style={{
        flex: 1, width: "100%", minWidth: 0,
        position: "relative", border: "none", borderRadius: 14,
        background: bg, color: "var(--ink)",
        padding: "8px 10px",
        display: "flex", alignItems: "center", gap: 10,
        textAlign: "left", overflow: "hidden",
        boxShadow: `inset 0 0 0 ${ringWidth}px ${ringColor}`,
        transition: "box-shadow 200ms ease, background 200ms ease",
        touchAction: "manipulation",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Tiny status label, top corner */}
      <span style={{
        position: "absolute", top: 5, left: 12,
        fontSize: 8, fontWeight: 800, letterSpacing: "0.14em",
        color: topLabelColor, textTransform: "uppercase",
      }}>{topLabel}</span>

      {/* Avatar — small, secondary */}
      <Avatar player={player} team={team} size={42} ringWidth={2} />

      {/* Name + points — main content */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
        <div style={{
          fontFamily: "var(--font-display)", fontWeight: 800,
          fontSize: "clamp(16px, 2.6vw, 24px)", letterSpacing: "-0.02em",
          color: "var(--ink)", lineHeight: 1.05,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{player.name}</div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11,
          color: "var(--bg-card)", background: teamColor,
          padding: "1px 7px", borderRadius: 999,
          marginTop: 4,
        }}>
          <span style={{ opacity: 0.7 }}>×</span>{points}
        </div>
      </div>

      {pulsing && (
        <span className="float-pt" style={{
          position: "absolute", left: "50%", top: "40%", transform: "translate(-50%, 0)",
          fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 44, color: teamColor,
          textShadow: "0 0 12px rgba(255,255,255,0.6)",
          pointerEvents: "none",
        }}>+1</span>
      )}
    </button>
  );
}

// ---------- Menu View (Stats + Roster) ----------
function MenuView({ state, menuTab, setMenuTab, onBack, onRotate, onReset, onResetAll, matchTarget, setMatchTarget, editingPlayerId, setEditingPlayerId, updatePlayer }) {
  const editingPlayer = state.players.find(p => p.id === editingPlayerId);
  const editingPlayerTeam = editingPlayer
    ? (state.currentMatch.teamA.includes(editingPlayer.id) ? "A" : "B")
    : "A";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12,
        borderBottom: "1px solid var(--line)",
      }}>
        <button onClick={onBack} style={{
          background: "transparent", border: "none", padding: 6,
          display: "flex", alignItems: "center", gap: 6, color: "var(--ink)",
        }}>
          <ArrowLeft size={18} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Back to court</span>
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6, padding: 3, background: "var(--bg-card)", borderRadius: 999, border: "1px solid var(--line)" }}>
          <TabBtn active={menuTab === "stats"} onClick={() => setMenuTab("stats")} icon={<Trophy size={13} />}>Stats</TabBtn>
          <TabBtn active={menuTab === "roster"} onClick={() => setMenuTab("roster")} icon={<Users size={13} />}>Roster</TabBtn>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 18px 28px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {menuTab === "stats" && <StatsView state={state} />}
          {menuTab === "roster" && (
            <RosterView
              state={state}
              matchTarget={matchTarget} setMatchTarget={setMatchTarget}
              onRotate={onRotate} onReset={onReset} onResetAll={onResetAll}
              setEditingPlayerId={setEditingPlayerId}
            />
          )}
        </div>
      </div>

      {/* Player edit sheet */}
      {editingPlayer && (
        <PlayerEditSheet
          player={editingPlayer} team={editingPlayerTeam}
          onClose={() => setEditingPlayerId(null)}
          updatePlayer={updatePlayer}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "var(--ink)" : "transparent",
      color: active ? "var(--bg)" : "var(--ink-muted)",
      border: "none", padding: "6px 12px", borderRadius: 999,
      fontWeight: 700, fontSize: 12, fontFamily: "var(--font-display)",
      display: "flex", alignItems: "center", gap: 5,
    }}>
      {icon}
      {children}
    </button>
  );
}

// ---------- Stats View ----------
function StatsView({ state }) {
  const { playerStats, comboStats, playerById } = useMemo(() => computeStats(state), [state]);

  const playerRows = Object.entries(playerStats).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.points - a.points);
  const comboRows = Object.entries(comboStats).map(([key, s]) => ({ key, ...s, winRate: s.played ? s.wins / s.played : 0 })).sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);

  if (state.matches.length === 0) {
    return (
      <div style={{
        background: "var(--bg-card)", border: "1px dashed var(--line)", borderRadius: 18,
        padding: "40px 24px", textAlign: "center", color: "var(--ink-muted)",
      }}>
        <Trophy size={36} style={{ opacity: 0.4, marginBottom: 12 }} />
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, color: "var(--ink)" }}>No matches yet</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Play a match and tap End to start tracking stats.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
      <Section title="Player leaderboard" sub="Total points across all matches">
        {playerRows.map((p, i) => {
          const player = state.players.find(pl => pl.id === p.id);
          const team = state.currentMatch.teamA.includes(p.id) ? "A" : "B";
          return (
            <Row key={p.id}>
              <RankBadge rank={i + 1} />
              <Avatar player={player} team={team} size={28} />
              <RowName>{p.name}</RowName>
              <RowMeta>{p.wins}W·{p.losses}L</RowMeta>
              <RowValue>{p.points}</RowValue>
            </Row>
          );
        })}
      </Section>

      <Section title="Best pairings" sub="Win rate by team combo">
        {comboRows.map((c, i) => (
          <Row key={c.key}>
            <RankBadge rank={i + 1} />
            <RowName>{c.ids.map((id) => playerById[id]?.name || "?").join(" + ")}</RowName>
            <RowMeta>{c.wins}W·{c.losses}L</RowMeta>
            <RowValue>{Math.round(c.winRate * 100)}%</RowValue>
          </Row>
        ))}
      </Section>

      <Section title="Recent matches" sub={`${state.matches.length} played`}>
        {state.matches.slice(0, 8).map((m) => (<MatchRow key={m.id} match={m} playerById={playerById} />))}
      </Section>
    </div>
  );
}

function Section({ title, sub, children }) {
  return (
    <section style={{ minWidth: 0 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        {sub && <div style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>{children}</div>
    </section>
  );
}

function Row({ children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
      borderBottom: "1px solid var(--line)",
    }}>{children}</div>
  );
}

function RankBadge({ rank }) {
  const isTop = rank === 1;
  return (
    <div style={{
      width: 22, height: 22, borderRadius: 6,
      background: isTop ? "var(--accent)" : "var(--bg)", border: "1px solid var(--line)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, flexShrink: 0,
    }}>{rank}</div>
  );
}

function RowName({ children }) { return <div style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</div>; }
function RowMeta({ children }) { return <div style={{ color: "var(--ink-muted)", fontSize: 11, flexShrink: 0 }}>{children}</div>; }
function RowValue({ children }) { return <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, flexShrink: 0, marginLeft: 8 }}>{children}</div>; }

function MatchRow({ match, playerById }) {
  const aNames = match.teamA.map((id) => playerById[id]?.name || "?").join(" + ");
  const bNames = match.teamB.map((id) => playerById[id]?.name || "?").join(" + ");
  const aWon = match.winner === "A";
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
        <div style={{ textAlign: "left", minWidth: 0 }}>
          <div style={{ fontSize: 9, color: "var(--teamA)", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>T1{aWon ? "·won" : ""}</div>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{aNames}</div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14, padding: "3px 9px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--line)" }}>{match.scoreA}–{match.scoreB}</div>
        <div style={{ textAlign: "right", minWidth: 0 }}>
          <div style={{ fontSize: 9, color: "var(--teamB)", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>T2{!aWon ? "·won" : ""}</div>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bNames}</div>
        </div>
      </div>
    </div>
  );
}

// ---------- Roster View ----------
function RosterView({ state, matchTarget, setMatchTarget, onRotate, onReset, onResetAll, setEditingPlayerId }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, margin: "0 0 10px", letterSpacing: "-0.01em" }}>Match settings</h2>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 12, color: "var(--ink-muted)", marginBottom: 8 }}>Match target</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[11, 15, 21].map((t) => {
              const active = t === matchTarget;
              return (
                <button key={t} onClick={() => setMatchTarget(t)} style={{
                  padding: "10px 8px", borderRadius: 10,
                  border: active ? "2px solid var(--ink)" : "1px solid var(--line)",
                  background: active ? "var(--ink)" : "var(--bg)",
                  color: active ? "var(--bg)" : "var(--ink)",
                  fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14,
                }}>to {t}</button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 8 }}>Win by 2 always.</div>

          <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={onRotate} style={{
              background: "var(--bg)", border: "1px solid var(--line)", padding: "10px 12px",
              borderRadius: 10, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--ink)",
            }}>
              <RefreshCcw size={14} />
              Rotate partners (next combo)
            </button>
            <button onClick={onReset} style={{
              background: "transparent", border: "1px solid var(--line)", padding: "10px 12px",
              borderRadius: 10, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--ink-muted)",
            }}>
              Discard current match
            </button>
            <button onClick={onResetAll} style={{
              background: "transparent", border: "1px solid var(--teamA)", padding: "10px 12px",
              borderRadius: 10, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--teamA)",
            }}>
              <Trash2 size={14} />
              Reset all stats
            </button>
            <div style={{ fontSize: 10, color: "var(--ink-muted)", textAlign: "center", lineHeight: 1.4 }}>
              Wipes match history & individual point totals. Keeps players & photos.
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, margin: "0 0 10px", letterSpacing: "-0.01em" }}>Players</h2>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
          {state.players.map((p, i) => {
            const team = i < 2 ? "A" : "B"; // current team layout (just for color)
            return (
              <button key={p.id} onClick={() => setEditingPlayerId(p.id)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                background: "transparent", border: "none",
                borderBottom: i < state.players.length - 1 ? "1px solid var(--line)" : "none",
                textAlign: "left",
              }}>
                <Avatar player={p} team={team} size={40} ringWidth={2} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 1 }}>
                    {p.avatar?.type === "photo" ? "Custom photo" : p.avatar?.type === "emoji" ? "Emoji avatar" : "Initials"} · tap to edit
                  </div>
                </div>
                <Edit3 size={15} color="var(--ink-muted)" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Player Edit Sheet ----------
function PlayerEditSheet({ player, team, onClose, updatePlayer }) {
  const [name, setName] = useState(player.name);
  const [working, setWorking] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { setName(player.name); }, [player.id]);

  const saveName = () => {
    const n = name.trim() || "Player";
    if (n !== player.name) updatePlayer(player.id, { name: n });
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setWorking(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 200);
      updatePlayer(player.id, { avatar: { type: "photo", value: dataUrl } });
    } catch (err) {
      console.error(err);
      alert("Couldn't load that image. Try another.");
    } finally {
      setWorking(false);
      e.target.value = "";
    }
  };

  const setEmoji = (emoji) => updatePlayer(player.id, { avatar: { type: "emoji", value: emoji } });
  const clearAvatar = () => updatePlayer(player.id, { avatar: null });

  return (
    <div onClick={() => { saveName(); onClose(); }} style={{
      position: "fixed", inset: 0, background: "rgba(20,16,12,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 460, maxHeight: "90vh", overflow: "auto",
        background: "var(--bg-card)", borderRadius: 18, border: "1px solid var(--line)",
        padding: "20px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>Edit player</div>
          <button onClick={() => { saveName(); onClose(); }} style={{
            background: "transparent", border: "none", padding: 6, color: "var(--ink-muted)",
          }}><X size={20} /></button>
        </div>

        {/* Avatar preview */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <Avatar player={{ ...player, name }} team={team} size={100} ringWidth={4} />
        </div>

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            placeholder="Player name"
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 10,
              border: "1px solid var(--line)", background: "var(--bg)",
              fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, color: "var(--ink)",
            }}
          />
        </div>

        {/* Photo */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Photo</div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => fileRef.current?.click()} disabled={working} style={{
              flex: 1, padding: "11px 12px", borderRadius: 10,
              background: "var(--ink)", color: "var(--bg)", border: "none",
              fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: working ? 0.6 : 1,
            }}>
              <Camera size={15} />
              {working ? "Loading…" : "Take or choose photo"}
            </button>
          </div>
        </div>

        {/* Emoji */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <Smile size={12} /> Or pick an emoji
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {FUN_EMOJIS.map((e) => {
              const active = player.avatar?.type === "emoji" && player.avatar.value === e;
              return (
                <button key={e} onClick={() => setEmoji(e)} style={{
                  aspectRatio: "1", padding: 0, borderRadius: 10,
                  background: active ? "var(--accent)" : "var(--bg)",
                  border: active ? "2px solid var(--ink)" : "1px solid var(--line)",
                  fontSize: 22, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                }}>{e}</button>
              );
            })}
          </div>
        </div>

        {/* Reset */}
        {player.avatar && (
          <button onClick={clearAvatar} style={{
            width: "100%", padding: "10px", borderRadius: 10, border: "1px solid var(--line)",
            background: "transparent", color: "var(--ink-muted)",
            fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
            <Trash2 size={13} />
            Reset to initials
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Portrait Court View — Option 1 (white & black classic)
// Identical functionality to landscape CourtView, but with photo-forward
// corner tiles and a giant stacked black score in the middle.
// ============================================================================

const PORTRAIT_TEAM_A = "#DC2626"; // saturated true-red
const PORTRAIT_TEAM_B = "#0891B2"; // saturated cyan-teal
const PORTRAIT_SCORE_INK = "#000000"; // pure black for max contrast

function PortraitCourtView({ teamA, teamB, scores, playerPoints, pulse, winner, matchPointTeam, matchTarget, eventCount, lastEventLabel, onTap, onLongPress, swapSelectedId, onSwapButton, onCancelSwap, playerById, onUndo, onEnd, onMenu, fireStreak, onReset, startedAt }) {
  const inSwapMode = !!swapSelectedId;
  const selectedName = swapSelectedId ? (playerById[swapSelectedId]?.name || "") : null;

  return (
    <>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: "10px 14px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: inSwapMode ? "var(--accent)" : "transparent",
        borderBottom: "0.5px solid #E5E5E5",
        transition: "background 200ms ease",
        minHeight: 40,
      }}>
        {inSwapMode ? (
          <>
            <button onClick={onCancelSwap} style={{
              background: "transparent", border: "none", padding: 6,
              display: "flex", alignItems: "center", gap: 6, color: "#1A1612",
            }}>
              <X size={16} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Cancel</span>
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1A1612", textAlign: "right" }}>
              Swap <span style={{ textDecoration: "underline" }}>{selectedName}</span>…
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={onMenu} style={{
                background: "transparent", border: "none", padding: 6,
                display: "flex", alignItems: "center", gap: 6, color: "#6B6359",
              }}>
                <Menu size={16} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Menu</span>
              </button>
              <button onClick={onReset} disabled={eventCount === 0} style={{
                background: "transparent", border: "none", padding: 6,
                display: "flex", alignItems: "center", color: "#6B6359",
                opacity: eventCount === 0 ? 0.3 : 1,
                cursor: eventCount === 0 ? "default" : "pointer",
              }} aria-label="Reset points">
                <RefreshCcw size={15} />
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#6B6359", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              To {matchTarget} · {eventCount} pt{eventCount === 1 ? "" : "s"}
            </div>
          </>
        )}
      </div>

      {/* Top row tiles — Team A (red), aligned with their score above */}
      <div style={{ flexShrink: 0, padding: "16px 24px 8px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {teamA[0] && (
          <PortraitPlayerTile player={teamA[0]} team="A" points={playerPoints[teamA[0].id] || 0}
            pulsing={pulse === teamA[0].id}
            onTap={() => onTap(teamA[0].id)} onLongPress={() => onLongPress(teamA[0].id)}
            isSwapSelected={swapSelectedId === teamA[0].id}
            isSwapTarget={swapSelectedId && swapSelectedId !== teamA[0].id}
              fireStreak={fireStreak} />
        )}
        {teamA[1] && (
          <PortraitPlayerTile player={teamA[1]} team="A" points={playerPoints[teamA[1].id] || 0}
            pulsing={pulse === teamA[1].id}
            onTap={() => onTap(teamA[1].id)} onLongPress={() => onLongPress(teamA[1].id)}
            isSwapSelected={swapSelectedId === teamA[1].id}
            isSwapTarget={swapSelectedId && swapSelectedId !== teamA[1].id}
              fireStreak={fireStreak} />
        )}
      </div>

      {/* Score (fills middle) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "8px 16px", minHeight: 0 }}>
        <PortraitScoreNumber value={scores.A} color={PORTRAIT_TEAM_A} matchPoint={!winner && (matchPointTeam === "A" || matchPointTeam === "both")} />
        <div style={{ width: "55%", height: 2, background: PORTRAIT_SCORE_INK, opacity: 0.18, margin: "10px 0", borderRadius: 1 }} />
        <PortraitScoreNumber value={scores.B} color={PORTRAIT_TEAM_B} matchPoint={!winner && (matchPointTeam === "B" || matchPointTeam === "both")} />
      </div>

      {/* Bottom row tiles — Team B (blue), aligned with their score above */}
      <div style={{ flexShrink: 0, padding: "8px 24px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        {teamB[0] && (
          <PortraitPlayerTile player={teamB[0]} team="B" points={playerPoints[teamB[0].id] || 0}
            pulsing={pulse === teamB[0].id}
            onTap={() => onTap(teamB[0].id)} onLongPress={() => onLongPress(teamB[0].id)}
            isSwapSelected={swapSelectedId === teamB[0].id}
            isSwapTarget={swapSelectedId && swapSelectedId !== teamB[0].id}
              fireStreak={fireStreak} />
        )}
        {teamB[1] && (
          <PortraitPlayerTile player={teamB[1]} team="B" points={playerPoints[teamB[1].id] || 0}
            pulsing={pulse === teamB[1].id}
            onTap={() => onTap(teamB[1].id)} onLongPress={() => onLongPress(teamB[1].id)}
            isSwapSelected={swapSelectedId === teamB[1].id}
            isSwapTarget={swapSelectedId && swapSelectedId !== teamB[1].id}
              fireStreak={fireStreak} />
        )}
      </div>

      {/* Footer */}
      <div style={{
        flexShrink: 0, padding: "10px 14px", display: "flex", gap: 8,
        borderTop: "0.5px solid #E5E5E5",
      }}>
        <button onClick={onUndo} disabled={eventCount === 0 || inSwapMode} style={{
          flex: 2, padding: "11px 14px", borderRadius: 10,
          border: "1px solid #DCD3C2",
          background: eventCount > 0 && !inSwapMode ? "var(--accent)" : "#FAFAFA",
          color: eventCount > 0 && !inSwapMode ? "#1A1612" : "#9A9A9A",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          opacity: eventCount > 0 && !inSwapMode ? 1 : 0.55, minWidth: 0,
        }}>
          <Undo2 size={14} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Undo{lastEventLabel ? ` · ${lastEventLabel}` : ""}
          </span>
        </button>
        <button onClick={inSwapMode ? onCancelSwap : onSwapButton} style={{
          flex: 1, padding: "11px 12px", borderRadius: 10,
          border: inSwapMode ? "1px solid #1A1612" : "1px solid #DCD3C2",
          background: inSwapMode ? "#1A1612" : "#FAFAFA",
          color: inSwapMode ? "#FFFFFF" : "#1A1612",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        }}>
          <Shuffle size={14} />
          <span>{inSwapMode ? "Cancel" : "Swap"}</span>
        </button>
        <button onClick={onEnd} disabled={inSwapMode} style={{
          flex: 1, padding: "11px 12px", borderRadius: 10,
          border: "1px solid #1A1612", background: "#1A1612", color: "#FFFFFF",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          opacity: inSwapMode ? 0.4 : 1,
        }}>
          <Flag size={13} />
          <span>End</span>
        </button>
      </div>

      {/* Victory: full match summary */}
      {winner && (
        <MatchSummaryCard
          scores={scores} playerPoints={playerPoints}
          teamA={teamA} teamB={teamB} winner={winner}
          startedAt={startedAt} matchTarget={matchTarget}
          onUndo={onUndo} onSaveAndPlayAgain={onEnd}
        />
      )}
    </>
  );
}

function PortraitPlayerTile({ player, team, points, pulsing, onTap, onLongPress, isSwapSelected, isSwapTarget, fireStreak }) {
  const teamColor = team === "A" ? PORTRAIT_TEAM_A : PORTRAIT_TEAM_B;
  const isOnFire = fireStreak?.player === player.id;
  const streakCount = isOnFire ? fireStreak.count : 0;

  // Long press detection (mirrors PlayerTile)
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);
  const startPos = useRef(null);

  const clearTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (e) => {
    longPressFired.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      onLongPress();
    }, 500);
  };

  const handlePointerMove = (e) => {
    if (!startPos.current || !longPressTimer.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimer();
  };

  const handlePointerUp = () => {
    clearTimer();
    startPos.current = null;
    if (!longPressFired.current) onTap();
  };

  const handlePointerCancel = () => {
    clearTimer();
    startPos.current = null;
    longPressFired.current = false;
  };

  const ringColor = isSwapSelected ? "#1A1612" : (isOnFire ? "#FF4500" : teamColor);
  const ringWidth = pulsing ? 5 : (isSwapSelected ? 4 : (isOnFire ? 4 : 3));

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={pulsing ? "pulse-tile" : ""}
      style={{
        background: "transparent", border: "none", padding: 4,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        opacity: isSwapTarget ? 0.85 : 1,
        position: "relative",
        touchAction: "manipulation",
        userSelect: "none", WebkitUserSelect: "none",
        cursor: "pointer",
      }}
    >
      <PortraitAvatar player={player} team={team} size={86} ringColor={ringColor} ringWidth={ringWidth} isSwapSelected={isSwapSelected} />
      {isOnFire && (
        <div className="mp-pulse" style={{
          position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)",
          background: "#FF4500", color: "white",
          fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}>🔥 ×{streakCount}</div>
      )}
      <div style={{
        fontFamily: "var(--font-display)", fontWeight: 800,
        fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase",
        color: "#000000", marginTop: 2,
        maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{player.name}</div>
      <div style={{
        fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11,
        padding: "2px 9px", borderRadius: 999,
        background: teamColor, color: "white",
      }}>×{points}</div>
      {pulsing && (
        <span className="float-pt" style={{
          position: "absolute", left: "50%", top: 12,
          transform: "translate(-50%, 0)",
          fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 32,
          color: teamColor, pointerEvents: "none",
        }}>+1</span>
      )}
    </button>
  );
}

function PortraitAvatar({ player, team, size = 86, ringColor, ringWidth = 3, isSwapSelected }) {
  const teamColor = team === "A" ? PORTRAIT_TEAM_A : PORTRAIT_TEAM_B;
  const fillColor = isSwapSelected ? "var(--accent)" : teamColor;
  const baseStyle = {
    width: size, height: size, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden", flexShrink: 0,
    boxShadow: `0 0 0 ${ringWidth}px ${ringColor || teamColor}`,
    transition: "box-shadow 200ms ease, background 200ms ease",
  };

  if (player.avatar?.type === "photo") {
    return <img src={player.avatar.value} alt={player.name} style={{ ...baseStyle, objectFit: "cover", background: "white" }} />;
  }
  if (player.avatar?.type === "emoji") {
    return (
      <div style={{ ...baseStyle, background: fillColor, fontSize: size * 0.55, lineHeight: 1 }}>
        {player.avatar.value}
      </div>
    );
  }
  // Initials in white on team color
  const initials = (player.name || "?").split(/\s+/).map((s) => s[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{
      ...baseStyle, background: fillColor, color: "white",
      fontFamily: "var(--font-display)", fontWeight: 800,
      fontSize: size * 0.36, letterSpacing: "-0.02em",
    }}>{initials}</div>
  );
}

function PortraitScoreNumber({ value, color, matchPoint }) {
  return (
    <div style={{ position: "relative", textAlign: "center", lineHeight: 1 }}>
      {matchPoint && (
        <div className="mp-pulse" style={{
          position: "absolute", top: -16, left: "50%",
          transform: "translateX(-50%)",
          fontSize: 10, fontWeight: 800,
          letterSpacing: "0.2em", textTransform: "uppercase",
          background: color, color: "white",
          padding: "3px 10px", borderRadius: 999,
          whiteSpace: "nowrap",
        }}>Match pt</div>
      )}
      <div style={{
        fontFamily: '"SF Compact Display", "Helvetica Neue", system-ui, sans-serif',
        fontWeight: 900,
        fontSize: "clamp(140px, 32vh, 280px)",
        letterSpacing: "-0.07em", lineHeight: 0.78,
        color: PORTRAIT_SCORE_INK,
      }}>
        {String(value).padStart(2, "0")}
      </div>
    </div>
  );
}

// ============================================================================
// Match Summary Card — shown after a winner is detected.
// Used by both landscape CourtView and PortraitCourtView.
// Shows team breakdown, MVP, match duration. Primary action saves and resets
// scores while keeping teams together for an immediate rematch.
// ============================================================================

function MatchSummaryCard({ scores, playerPoints, teamA, teamB, winner, startedAt, matchTarget, onUndo, onSaveAndPlayAgain }) {
  // Compute MVP: highest individual scorer (across both teams, ties go to winning team)
  const allPlayers = [...teamA, ...teamB];
  let mvp = null;
  let mvpPts = -1;
  for (const p of allPlayers) {
    const pts = playerPoints[p.id] || 0;
    const onWinningTeam = winner === "A" ? teamA.some((q) => q.id === p.id) : teamB.some((q) => q.id === p.id);
    // ties go to the winner's team
    if (pts > mvpPts || (pts === mvpPts && onWinningTeam && !(mvp && winner === "A" ? teamA.some((q) => q.id === mvp.id) : teamB.some((q) => q.id === mvp?.id)))) {
      mvp = p; mvpPts = pts;
    }
  }

  const durationMs = startedAt ? Date.now() - startedAt : 0;
  const durationStr = formatDuration(durationMs);

  const renderTeam = (label, players, color) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase",
        color: color, marginBottom: 8, textAlign: "left",
      }}>{label}</div>
      {players.map((p) => {
        const pts = playerPoints[p.id] || 0;
        const isMvp = mvp && p.id === mvp.id;
        return (
          <div key={p.id} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
            minWidth: 0,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: color, color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 11,
              flexShrink: 0, overflow: "hidden",
            }}>
              {p.avatar?.type === "photo" ? (
                <img src={p.avatar.value} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : p.avatar?.type === "emoji" ? (
                <span style={{ fontSize: 16 }}>{p.avatar.value}</span>
              ) : (
                (p.name || "?").split(/\s+/).map((s) => s[0]).filter(Boolean).join("").slice(0, 2).toUpperCase()
              )}
            </div>
            <div style={{
              flex: 1, fontSize: 13, fontWeight: 600,
              fontFamily: "var(--font-display)", color: "#1A1612",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{p.name}{isMvp && <span style={{ marginLeft: 6, fontSize: 11 }}>🌟</span>}</div>
            <div style={{
              fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13,
              color: color, flexShrink: 0,
            }}>×{pts}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(26,22,18,0.88)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 50, padding: 20, overflow: "auto",
    }}>
      <div style={{
        background: "#FBF7EE", borderRadius: 20, padding: "20px 24px 22px",
        maxWidth: 420, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        {/* Header pill */}
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{
            fontSize: 10, color: "#F2D74E", fontWeight: 800,
            letterSpacing: "0.2em", textTransform: "uppercase",
            background: "#1A1612", display: "inline-block",
            padding: "4px 12px", borderRadius: 999,
          }}>🏆 Match complete</div>
        </div>

        {/* Big result */}
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontWeight: 800,
            fontSize: 22, letterSpacing: "-0.02em", color: "#1A1612",
          }}>
            Team {winner === "A" ? "1" : "2"} wins
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontWeight: 700,
            fontSize: 44, marginTop: 2, color: "#1A1612",
            letterSpacing: "-0.04em", lineHeight: 1,
          }}>
            {scores.A}–{scores.B}
          </div>
          <div style={{
            fontSize: 11, color: "#6B6359", fontWeight: 600,
            letterSpacing: "0.08em", textTransform: "uppercase",
            marginTop: 6,
          }}>
            To {matchTarget} · {durationStr}
          </div>
        </div>

        {/* Team breakdowns side by side */}
        <div style={{
          display: "flex", gap: 14, padding: "14px 0",
          borderTop: "1px solid #DCD3C2", borderBottom: "1px solid #DCD3C2",
          marginBottom: 14,
        }}>
          {renderTeam("Team 1", teamA, "#D63B26")}
          <div style={{ width: 1, background: "#DCD3C2" }}></div>
          {renderTeam("Team 2", teamB, "#0F4C4C")}
        </div>

        {/* MVP callout */}
        {mvp && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontSize: 12, color: "#6B6359", fontWeight: 600,
            marginBottom: 14,
          }}>
            <span>🌟</span>
            <span>MVP:</span>
            <span style={{ color: "#1A1612", fontWeight: 800 }}>{mvp.name}</span>
            <span>· {mvpPts} pt{mvpPts === 1 ? "" : "s"}</span>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onUndo} style={{
            flex: 1, padding: 11, borderRadius: 12, border: "1px solid #DCD3C2",
            background: "transparent", color: "#1A1612",
            fontWeight: 600, fontSize: 13, fontFamily: "var(--font-display)",
            cursor: "pointer",
          }}>Undo last point</button>
          <button onClick={onSaveAndPlayAgain} style={{
            flex: 2, padding: 11, borderRadius: 12, border: "none",
            background: "#1A1612", color: "#FBF7EE",
            fontWeight: 800, fontSize: 13, fontFamily: "var(--font-display)",
            cursor: "pointer",
          }}>Save & play again</button>
        </div>
        <div style={{
          fontSize: 11, color: "#9A9A9A", fontWeight: 500,
          textAlign: "center", marginTop: 8, fontStyle: "italic",
        }}>Tip: screenshot this card to share the result</div>
      </div>
    </div>
  );
}