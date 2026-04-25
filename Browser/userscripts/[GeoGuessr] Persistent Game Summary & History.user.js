// ==UserScript==
// @name         [GeoGuessr] Persistent Game Summary & History
// @version      2026-04-01
// @description  Optimized slide-out match history drawer with tracking, ELO, analytics, and progress graphs with moving averages and candlestick views. Includes Team Duel detection.
// @author       PixlPainter
// @match        https://www.geoguessr.com/*
// @icon         https://www.google.com/s2/favicons?bb=geoguessr.com
// @grant        none
// @run-at       document-start
// ==/UserScript==

// == CREDITS ==
// Thanks @LodunCoombs (GitHub) for suggesting the duels feed endpoint!

(function() {
    'use strict';

    // --- Configuration & State ---
    const TARGET_DELETE_URL_PART = "api/duels/ongoing";
    const TARGET_METHOD = "DELETE";
    const STORAGE_KEY_LAST = 'geoguessr_last_duel_id';
    const STORAGE_KEY_HISTORY = 'geoguessr_game_history_db';
    
    const FEED_API = "/api/v4/feed/private";
    const GAME_SERVER_API = "https://game-server.geoguessr.com/api/duels/";
    const USER_API = "/api/v3/users/";

    let lastGameId = localStorage.getItem(STORAGE_KEY_LAST) || null;
    let gameHistory = JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || "[]");
    let currentPath = window.location.pathname;
    let lastInGameStatus = false;
    let isHydrating = false;
    let activeChart = null;
    let cachedUserId = null;
    
    // Internal tracking to prevent redundant fetching in a single session
    const sessionFetchedIds = new Set();

    // Graph State Persistence
    let lastMetric = 'ratingAfter';
    let lastTimeframe = '7d';
    let lastTypeFilter = 'Ranked'; 
    let lastModeFilter = 'All';    
    let lastShowMA = false;
    let lastCandleMode = 'none'; // 'none', 'hourly', 'daily', 'monthly'

    // --- Optimized Styles ---
    const injectStyles = () => {
        if (document.getElementById('pers-history-styles')) return;
        const style = document.createElement('style');
        style.id = 'pers-history-styles';
        style.innerHTML = `
            #history-drawer {
                width: 400px; height: 100%; background: rgba(18, 18, 35, 0.94);
                border-right: 1px solid rgba(255, 255, 255, 0.15);
                box-shadow: 20px 0 60px rgba(0,0,0,0.4);
                display: flex; flex-direction: column;
                transform: translateX(-100%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                backdrop-filter: blur(30px); pointer-events: auto;
            }
            #drawer-trigger-tab {
                position: fixed; left: 0; top: 50%; transform: translateY(-50%);
                width: 30px; height: 120px; background: rgba(121, 82, 233, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.2); border-left: none;
                border-radius: 0 16px 16px 0; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                backdrop-filter: blur(10px); transition: all 0.3s; z-index: 10001;
            }
            #drawer-trigger-tab:hover { background: rgba(121, 82, 233, 0.4); }
            .history-row {
                display: block; padding: 20px; margin-bottom: 18px;
                background: rgba(255, 255, 255, 0.04); border-radius: 18px;
                color: white; border: 1px solid rgba(255, 255, 255, 0.08);
                transition: background 0.2s, transform 0.2s, border-color 0.2s; cursor: pointer;
            }
            .history-row.active { background: rgba(121, 82, 233, 0.4); border-color: #b094ff; box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
            .history-row:hover:not(.active) { background: rgba(255, 255, 255, 0.1); transform: translateX(8px); }
            
            .filter-btn-group { display: flex; background: rgba(255,255,255,0.08); padding: 5px; border-radius: 12px; gap: 5px; width: fit-content; align-items: center; }
            .tf-btn, .metric-btn, .type-btn, .mode-btn, .ma-btn, .candle-btn { padding: 8px 14px; border: none; border-radius: 8px; font-size: 10px; font-weight: 800; cursor: pointer; background: transparent; color: #888; transition: all 0.2s; white-space: nowrap; }
            .tf-btn.active, .metric-btn.active, .type-btn.active, .mode-btn.active, .ma-btn.active, .candle-btn.active { background: #7952e9; color: white; box-shadow: 0 4px 12px rgba(121, 82, 233, 0.3); }
            
            .opponent-nick { border-bottom: 1px solid transparent; transition: border-color 0.2s; }
            .opponent-nick:hover { border-bottom-color: rgba(255, 255, 255, 0.4) !important; }
            
            @keyframes pulse-warn {
                0% { opacity: 0.6; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.01); }
                100% { opacity: 0.6; transform: scale(1); }
            }
            .sync-warning {
                background: rgba(255, 166, 0, 0.1); border: 1px solid rgba(255, 166, 0, 0.2);
                color: #ffca28; padding: 10px 20px; border-radius: 12px; font-size: 11px; font-weight: 700;
                display: flex; align-items: center; gap: 8px; margin-bottom: 15px; animation: pulse-warn 2s infinite ease-in-out;
            }
        `;
        document.head.appendChild(style);
    };

    const loadChartJS = () => {
        if (window.Chart) return Promise.resolve();
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            script.onload = resolve;
            document.head.appendChild(script);
        });
    };

    const formatModeName = (mode, isRated = true) => {
        let base = "Moving";
        if (mode === "NmpzDuels") base = "NMPZ";
        else if (mode === "NoMoveDuels") base = "No Move";
        else if (mode === "Duels" || mode === "Duel" || mode === "StandardDuels" || mode === "Standard") base = "Moving";
        else if (mode) base = mode.replace('Duels', '').replace('Duel', '');
        return isRated ? base : `Unranked - ${base}`;
    };

    const saveHistory = () => {
        const map = new Map();
        const prioritized = [...gameHistory].sort((a, b) => (b.hydrated ? 1 : 0) - (a.hydrated ? 1 : 0));
        for (const item of prioritized) {
            if (!map.has(item.gameId)) {
                map.set(item.gameId, item);
            }
        }
        gameHistory = Array.from(map.values())
            .sort((a, b) => new Date(b.time) - new Date(a.time))
            .slice(0, 2000); 
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(gameHistory));
    };

    const getUserId = () => {
        if (cachedUserId) return cachedUserId;
        try {
            const nextData = JSON.parse(document.getElementById('__NEXT_DATA__')?.innerHTML || '{}');
            cachedUserId = nextData?.props?.accountProps?.account?.user?.userId || nextData?.props?.pageProps?.user?.userId || null;
            return cachedUserId;
        } catch (e) { return null; }
    };

    const hydrateGameDetails = async (gameId) => {
        try {
            const duelResponse = await fetch(`${GAME_SERVER_API}${gameId}`, { credentials: 'include' });
            if (!duelResponse.ok) {
                // Return a full object with default markers to satisfy the hydration check
                if (duelResponse.status === 403 || duelResponse.status === 404) {
                    return { opponent: "Private/Deleted Match", hydrated: true, gameCount: 1, isTeamDuel: false, mmi: "0.00", avgScore: 0, ratingChange: 0, avgTime: "0.0" };
                }
                return null;
            }
            const data = await duelResponse.json();
            const myId = getUserId();
            const teams = data.teams || [];
            if (teams.length < 2) return null;

            let myTeam = teams.find(t => t.players.some(p => p.playerId === myId));
            let me;
            if (myTeam) {
                me = myTeam.players.find(p => p.playerId === myId);
            } else {
                me = teams.flatMap(t => t.players).find(p => p.guesses && p.guesses.length > 0) || teams[0].players[0];
                myTeam = teams.find(t => t.players.includes(me)) || teams[0];
            }

            const opponentTeam = teams.find(t => t !== myTeam) || teams[1];
            
            const opponentNames = await Promise.all(opponentTeam.players.map(async p => {
                if (p.nick && String(p.nick) !== "undefined") return p.nick;
                if (!p.playerId) return "Unknown";
                const userRes = await fetch(`${USER_API}${p.playerId}`);
                if (userRes.ok) {
                    const prof = await userRes.json();
                    return (prof && prof.nick && String(prof.nick) !== "undefined") ? prof.nick : "Unknown";
                }
                if (userRes.status === 404) return "Deleted User";
                return "Unknown";
            }));
            
            const nick = opponentNames.filter(n => !!n && n !== "undefined").join(" & ") || "Unknown Opponent";

            const isTeamDuel = teams.some(t => t.players.length > 1);
            const progress = me.progressChange?.rankedSystemProgress;
            const isRated = data.options?.isRated !== false;

            let rBefore = progress?.ratingBefore, rAfter = progress?.ratingAfter, rChange = progress?.ratingChange;
            if (rChange === undefined && rAfter !== undefined && rBefore !== undefined) rChange = rAfter - rBefore;

            const gameModeRatingAfter = progress?.gameModeRatingAfter || 0;
            const validGuesses = me.guesses?.filter(g => (g.score || 0) > 500) || [];
            const totalScore = validGuesses.reduce((acc, g) => acc + (g.score || 0), 0);
            const avgScore = validGuesses.length ? Math.round(totalScore / validGuesses.length) : 0;

            let totalTimeMs = 0;
            const activeRounds = data.rounds?.slice(0, data.currentRoundNumber) || [];
            activeRounds.forEach(r => {
                if (r.startTime && r.endTime) totalTimeMs += (new Date(r.endTime) - new Date(r.startTime));
            });
            const avgTime = activeRounds.length ? (totalTimeMs / activeRounds.length / 1000).toFixed(1) : 0;

            const calcWeightedMulti = (roundArray) => {
                let damageWeight = 0; let totalDamage = 0;
                roundArray.forEach(r => {
                    const dmg = r.damageDealt || 0;
                    if (dmg > 0) {
                        totalDamage += dmg;
                        damageWeight += (dmg * (r.multiplier || 1));
                    }
                });
                return totalDamage > 0 ? (damageWeight / totalDamage) : 0;
            };

            const mmi = (calcWeightedMulti(myTeam.roundResults || []) - calcWeightedMulti(opponentTeam.roundResults || [])).toFixed(2);

            // Corrupt check improved to move on from permanent match issues
            const isCorrupt = (data.currentRoundNumber > 1 && avgScore === 0 && (!me.guesses || me.guesses.length === 0));
            if (isCorrupt) return { opponent: nick, hydrated: true, gameCount: 1, isTeamDuel: isTeamDuel, mmi: "0.00", avgScore: 0, ratingChange: 0, avgTime: "0.0" };
            
            return {
                opponent: nick,
                opponentId: opponentTeam.players[0]?.playerId,
                ratingBefore: rBefore || 0,
                ratingAfter: rAfter || 0,
                gameModeRatingAfter: gameModeRatingAfter,
                ratingChange: rChange || 0,
                win: data.result?.winningTeamId === myTeam.id,
                mode: formatModeName(progress?.gameMode || data.options?.competitiveGameMode, isRated),
                isTeamDuel: isTeamDuel,
                avgScore, avgTime, mmi,
                gameCount: 1, 
                hydrated: true
            };
        } catch (e) { return null; }
    };

    const fetchRecentGames = async (paginationToken = null) => {
        try {
            const url = paginationToken ? `${FEED_API}?paginationToken=${paginationToken}` : FEED_API;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            
            const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            let foundNew = false;
            let stopSync = false;
            let oldestFoundTime = Date.now();

            const processEntry = (entry) => {
                const entryTime = new Date(entry.time).getTime();
                oldestFoundTime = Math.min(oldestFoundTime, entryTime);
                const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload;
                
                if (Array.isArray(payload)) {
                    payload.forEach(item => processEntry({ ...item, time: item.time || entry.time }));
                    return;
                }
                
                if (payload?.gameId && (entry.type === 11 || entry.type === 6)) {
                    // Check session set to prevent recursive loops
                    if (sessionFetchedIds.has(payload.gameId)) return;
                    sessionFetchedIds.add(payload.gameId);

                    if (!gameHistory.some(g => g.gameId === payload.gameId)) {
                        gameHistory.push({
                            gameId: payload.gameId,
                            time: entry.time,
                            mode: formatModeName(payload.competitiveGameMode || payload.gameMode),
                            hydrated: false
                        });
                        foundNew = true;
                    } else {
                        // Found overlap. Stop sync to prevent infinite feed loops.
                        stopSync = true;
                    }
                }
            };

            if (data.entries) data.entries.forEach(processEntry);
            if (foundNew) {
                saveHistory();
                updateUI(true);
            }

            if (!stopSync && data.paginationToken && oldestFoundTime > oneMonthAgo) {
                await new Promise(r => setTimeout(r, 200));
                await fetchRecentGames(data.paginationToken);
            } else {
                startBackgroundHydration();
            }
        } catch (err) {}
    };

    const startBackgroundHydration = async () => {
        if (isHydrating) return;
        isHydrating = true;
        while (true) {
            // Updated predicate: satisfy ALL tracking markers to move on
            const game = gameHistory.find(g => !g.hydrated || g.mmi === undefined || g.isTeamDuel === undefined || g.avgTime === undefined);
            if (!game) break;

            const details = await hydrateGameDetails(game.gameId);
            const idx = gameHistory.findIndex(g => g.gameId === game.gameId);
            if (idx !== -1) {
                // Critical Fix: Always assign values for MMI and isTeamDuel to break the search loop
                if (details) {
                    gameHistory[idx] = { ...gameHistory[idx], ...details };
                } else {
                    gameHistory[idx] = { ...gameHistory[idx], hydrated: true, mmi: "0.00", isTeamDuel: false, avgTime: "0.0", avgScore: 0 };
                }
                saveHistory();
                injectDrawerHistory(true); 
                if (document.getElementById('history-graph-modal')) {
                    showRatingGraph(lastTimeframe, lastMetric, lastTypeFilter, lastModeFilter, lastShowMA, lastCandleMode);
                }
            }
            await new Promise(r => setTimeout(r, 150));
        }
        isHydrating = false;
    };

    const interceptNetwork = () => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const url = args[0] instanceof Request ? args[0].url : args[0];
            const options = args[1] || (args[0] instanceof Request ? args[0] : {});
            if (typeof url === 'string' && url.includes(TARGET_DELETE_URL_PART) && (options.method || 'GET').toUpperCase() === TARGET_METHOD) {
                return new Response(null, { status: 204 });
            }
            return originalFetch(...args);
        };
    };

    const interceptWebSocket = () => {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const OriginalWebSocket = targetWindow.WebSocket;
        targetWindow.WebSocket = new Proxy(OriginalWebSocket, {
            construct(target, args) {
                const socket = new target(...args);
                socket.addEventListener('message', async (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data?.code === 'DuelFinished' && data.gameId) {
                            lastGameId = data.gameId;
                            localStorage.setItem(STORAGE_KEY_LAST, lastGameId);
                            const state = data.duel?.state;
                            const myId = getUserId();
                            const teams = state?.teams || [];
                            if (teams.length < 2) return;
                            const myTeam = teams.find(t => t.players.some(p => p.playerId === myId)) || teams[0];
                            const oppTeam = teams.find(t => t !== myTeam) || teams[1];
                            const opp = oppTeam.players[0];
                            const prog = myTeam.players.find(p => p.playerId === myId)?.progressChange?.rankedSystemProgress;
                            let rChange = prog?.ratingChange;
                            if (rChange === undefined && prog) rChange = (prog.ratingAfter || 0) - (prog.ratingBefore || 0);
                            const isTeamDuel = teams.some(t => t.players.length > 1);
                            gameHistory.unshift({
                                gameId: data.gameId,
                                time: new Date().toISOString(),
                                mode: formatModeName(state.options?.competitiveGameMode || state.options?.gameMode, state.options?.isRated !== false),
                                opponent: (opp && opp.nick && String(opp.nick) !== "undefined") ? opp.nick : "Unknown Opponent",
                                opponentId: opp?.playerId,
                                ratingBefore: prog?.ratingBefore || 0,
                                ratingAfter: prog?.ratingAfter || 0,
                                gameModeRatingAfter: prog?.gameModeRatingAfter || 0,
                                ratingChange: rChange || 0,
                                win: state.result?.winningTeamId === myTeam.id,
                                isTeamDuel: isTeamDuel,
                                gameCount: 1,
                                hydrated: false 
                            });
                            saveHistory();
                            startBackgroundHydration();
                            updateUI(true);
                        }
                    } catch (e) {}
                });
                return socket;
            }
        });
    };

    const updateUI = (force = false) => {
        const path = window.location.pathname;
        const inGameElement = document.querySelector('[class*="gm-style-"]');
        const isInGame = !!inGameElement || path.includes('/game/') || (path.includes('/duels/') && !path.includes('/summary'));

        if (!force && path === currentPath && isInGame === lastInGameStatus) return; 
        currentPath = path;
        lastInGameStatus = isInGame;

        if (!isInGame) {
            injectStyles();
            injectDrawerHistory(force);
        } else {
            document.getElementById('history-drawer-root')?.remove();
            document.getElementById('drawer-trigger-tab')?.remove();
        }
    };

    const getChartData = (timeframe, metric, typeFilter, modeFilter) => {
        const now = Date.now();
        const cutoff = timeframe === 'All' ? 0 : now - (timeframe === '24h' ? 86400000 : timeframe === '7d' ? 604800000 : 2592000000);
        let filtered = gameHistory.filter(g => {
            if (g.isTeamDuel) return false;
            const d = new Date(g.time);
            const dateMatch = d.getTime() >= cutoff;
            if (!g.hydrated || !dateMatch) return false;
            const isUnranked = g.mode && g.mode.startsWith('Unranked');
            if (typeFilter === 'Ranked' && isUnranked) return false;
            if (typeFilter === 'Unranked' && !isUnranked) return false;
            if (modeFilter !== 'All') {
                const subMode = g.mode.replace('Unranked - ', '');
                if (modeFilter === 'NM' && subMode !== 'No Move') return false;
                if (modeFilter !== 'NM' && subMode !== modeFilter) return false;
            }
            if (metric === 'ratingAfter' && isUnranked) return false;
            return true;
        }).sort((a, b) => new Date(a.time) - new Date(b.time)); 

        return filtered.map(g => {
            const d = new Date(g.time);
            let val = metric === 'ratingAfter' ? ((modeFilter !== 'All' && g.gameModeRatingAfter) ? g.gameModeRatingAfter : g.ratingAfter) : (metric === 'gameCount' ? 1 : parseFloat(g[metric]));
            return {
                label: timeframe === '24h' ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                hourlyKey: d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) + ' ' + d.getHours() + ':00',
                dailyKey: d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }),
                monthlyKey: d.toLocaleDateString([], { month: 'long', year: 'numeric' }),
                value: val, opponent: g.opponent, mode: g.mode, gameId: g.gameId
            };
        });
    };

    const showRatingGraph = async (timeframe = '7d', metric = 'ratingAfter', typeFilter = 'Ranked', modeFilter = 'All', showMA = false, candleMode = 'none') => {
        if (metric === 'gameCount' && candleMode === 'none') candleMode = 'daily';
        lastTimeframe = timeframe; lastMetric = metric; lastTypeFilter = typeFilter; lastModeFilter = modeFilter; lastShowMA = showMA; lastCandleMode = candleMode;
        await loadChartJS();
        let modal = document.getElementById('history-graph-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'history-graph-modal';
            modal.style.cssText = `position: fixed; inset: 0; background: rgba(10, 10, 20, 0.7); z-index: 20000; display: flex; align-items: center; justify-content: center; font-family: var(--font-neo-sans, sans-serif); backdrop-filter: blur(15px);`;
            document.body.appendChild(modal);
        }
        const chartData = getChartData(timeframe, metric, typeFilter, modeFilter);
        const metricLabels = { ratingAfter: 'Rating History', avgScore: 'Average Score', mmi: 'Multi-Merchant Index', avgTime: 'Average Time (s)', gameCount: `Games per ${candleMode === 'hourly' ? 'Hour' : (candleMode === 'monthly' ? 'Month' : 'Day')}` };
        const needsHydration = gameHistory.some(g => !g.hydrated);
        modal.innerHTML = `
            <div style="background: rgba(26, 26, 46, 0.98); width: 95%; max-width: 1300px; min-height: 800px; border-radius: 32px; border: 1px solid rgba(255,255,255,0.15); position: relative; padding: 40px; display: flex; flex-direction: column; box-shadow: 0 40px 150px rgba(0,0,0,0.6);">
                ${needsHydration ? `<div class="sync-warning">Syncing match history... data may be incomplete.</div>` : ''}
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
                    <div><h2 style="margin: 0; color: white; text-transform: uppercase; letter-spacing: 5px; font-weight: 900; font-size: 24px;">${metricLabels[metric]}</h2></div>
                    <button id="close-graph" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; font-size: 22px;">✕</button>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; gap: 15px; flex-wrap: wrap;">
                    <div class="filter-btn-group">
                        <button class="metric-btn ${metric==='ratingAfter'?'active':''}" data-m="ratingAfter">Rating</button>
                        <button class="metric-btn ${metric==='avgScore'?'active':''}" data-m="avgScore">Score</button>
                        <button class="metric-btn ${metric==='mmi'?'active':''}" data-m="mmi">Merchant</button>
                        <button class="metric-btn ${metric==='avgTime'?'active':''}" data-m="avgTime">Time</button>
                        <button class="metric-btn ${metric==='gameCount'?'active':''}" data-m="gameCount">Count</button>
                    </div>
                    <div class="filter-btn-group"><button class="type-btn ${typeFilter==='Ranked'?'active':''}" data-type="Ranked">Ranked</button><button class="type-btn ${typeFilter==='Unranked'?'active':''}" data-type="Unranked">Unranked</button><button class="type-btn ${typeFilter==='All'?'active':''}" data-type="All">All Status</button></div>
                    <div class="filter-btn-group"><button class="mode-btn ${modeFilter==='NMPZ'?'active':''}" data-mode="NMPZ">NMPZ</button><button class="mode-btn ${modeFilter==='NM'?'active':''}" data-mode="NM">NM</button><button class="mode-btn ${modeFilter==='Moving'?'active':''}" data-mode="Moving">Moving</button><button class="mode-btn ${modeFilter==='All'?'active':''}" data-mode="All">All Modes</button></div>
                    <div class="filter-btn-group"><button class="tf-btn ${timeframe==='24h'?'active':''}" data-tf="24h">24H</button><button class="tf-btn ${timeframe==='7d'?'active':''}" data-tf="7d">WEEK</button><button class="tf-btn ${timeframe==='30d'?'active':''}" data-tf="30d">MONTH</button><button class="tf-btn ${timeframe==='All'?'active':''}" data-tf="All">ALL</button></div>
                </div>
                <div style="flex: 1; min-height: 450px; position: relative;"><canvas id="ratingChart"></canvas></div>
                <div style="display: flex; justify-content: center; margin-top: 30px; gap: 20px;">
                    <div class="filter-btn-group"><button class="ma-btn ${showMA ? 'active' : ''}" id="ma-toggle-btn">Trend Line</button></div>
                    <div class="filter-btn-group"><button class="candle-btn ${candleMode==='none'?'active':''}" data-cm="none" id="candle-none-btn">Points</button><button class="candle-btn ${candleMode==='hourly'?'active':''}" data-cm="hourly">Hourly</button><button class="candle-btn ${candleMode==='daily'?'active':''}" data-cm="daily">Daily</button><button class="candle-btn ${candleMode==='monthly'?'active':''}" data-cm="monthly">Monthly</button></div>
                </div>
            </div>
        `;
        if (metric === 'gameCount') { const nb = modal.querySelector('#candle-none-btn'); if (nb) { nb.style.opacity = '0.3'; nb.style.pointerEvents = 'none'; } }
        modal.querySelectorAll('.tf-btn').forEach(btn => btn.onclick = () => showRatingGraph(btn.dataset.tf, metric, typeFilter, modeFilter, showMA, candleMode));
        modal.querySelectorAll('.metric-btn').forEach(btn => btn.onclick = () => { let nc = candleMode; if (btn.dataset.m === 'gameCount' && candleMode === 'none') nc = 'daily'; showRatingGraph(timeframe, btn.dataset.m, typeFilter, modeFilter, showMA, nc); });
        modal.querySelectorAll('.type-btn').forEach(btn => btn.onclick = () => showRatingGraph(timeframe, metric, btn.dataset.type, modeFilter, showMA, candleMode));
        modal.querySelectorAll('.mode-btn').forEach(btn => btn.onclick = () => showRatingGraph(timeframe, metric, typeFilter, btn.dataset.mode, showMA, candleMode));
        modal.querySelectorAll('.candle-btn').forEach(btn => btn.onclick = () => showRatingGraph(timeframe, metric, typeFilter, modeFilter, showMA, btn.dataset.cm));
        modal.querySelector('#ma-toggle-btn').onclick = () => showRatingGraph(timeframe, metric, typeFilter, modeFilter, !showMA, candleMode);
        modal.querySelector('#close-graph').onclick = () => { modal.remove(); activeChart = null; };

        const ctx = document.getElementById('ratingChart').getContext('2d');
        if (activeChart) activeChart.destroy();
        let labels = []; const datasets = []; let candleGroups = new Map();
        if (candleMode !== 'none') {
            const groupKey = candleMode === 'hourly' ? 'hourlyKey' : (candleMode === 'monthly' ? 'monthlyKey' : 'dailyKey');
            chartData.forEach(d => {
                if (!candleGroups.has(d[groupKey])) candleGroups.set(d[groupKey], { open: d.value, high: d.value, low: d.value, close: d.value, count: 1, values: [d.value], label: candleMode === 'hourly' ? d.label : (candleMode === 'monthly' ? d.monthlyKey : d.dailyKey) });
                else { const g = candleGroups.get(d[groupKey]); g.high = Math.max(g.high, d.value); g.low = Math.min(g.low, d.value); g.close = d.value; g.count++; g.values.push(d.value); }
            });
            labels = Array.from(candleGroups.values()).map(g => g.label); const groupsArr = Array.from(candleGroups.values());
            if (metric === 'gameCount') { datasets.push({ type: 'bar', label: 'Games Played', data: groupsArr.map(g => g.count), backgroundColor: 'rgba(121, 82, 233, 0.5)', borderColor: '#7952e9', borderWidth: 2, borderRadius: 6, barPercentage: 0.7, grouped: false, candleRaw: groupsArr }); }
            else { datasets.push({ type: 'bar', label: 'Wicks', data: groupsArr.map(g => [g.low, g.high]), backgroundColor: (ctx) => groupsArr[ctx.dataIndex].close >= groupsArr[ctx.dataIndex].open ? '#4caf50' : '#ff5252', barThickness: 2, grouped: false }); datasets.push({ type: 'bar', label: 'Candle Body', data: groupsArr.map(g => g.open === g.close ? [g.open - 0.5, g.close + 0.5] : [Math.min(g.open, g.close), Math.max(g.open, g.close)]), backgroundColor: (ctx) => groupsArr[ctx.dataIndex].close >= groupsArr[ctx.dataIndex].open ? '#4caf50' : '#ff5252', barPercentage: 0.6, grouped: false, candleRaw: groupsArr }); }
        } else { labels = chartData.map(d => d.label); datasets.push({ type: 'line', label: 'Actual', data: chartData.map(d => d.value), opponents: chartData.map(d => d.opponent), modes: chartData.map(d => d.mode), borderColor: '#9d7fff', backgroundColor: (ctx) => { const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 400); gradient.addColorStop(0, 'rgba(157, 127, 255, 0.2)'); gradient.addColorStop(1, 'rgba(157, 127, 255, 0)'); return gradient; }, borderWidth: 3, pointStyle: 'circle', pointRadius: chartData.length > 50 ? 3 : 5, pointHoverRadius: 8, pointBackgroundColor: '#fff', pointBorderColor: '#7952e9', pointBorderWidth: 2, fill: true, tension: 0.4, z: 10 }); }
        if (showMA) { const smaWindow = 10; const sourceData = candleMode !== 'none' ? Array.from(candleGroups.values()).map(v => metric === 'gameCount' ? v.count : v.values.reduce((a,b)=>a+b,0)/v.values.length) : chartData.map(d => d.value); const maValues = []; for (let i = 0; i < sourceData.length; i++) { const slice = sourceData.slice(Math.max(0, i - smaWindow + 1), i + 1); maValues.push(slice.reduce((a, b) => a + b, 0) / slice.length); } datasets.push({ type: 'line', label: 'Trend', data: maValues, borderColor: 'rgba(255, 255, 255, 0.4)', borderDash: [5, 5], borderWidth: 2, pointRadius: 0, fill: false, tension: 0.4, z: 1, grouped: false }); }
        const flat = []; datasets.forEach(ds => ds.data.forEach(v => Array.isArray(v) ? flat.push(v[0], v[1]) : (v !== null && flat.push(v))));
        let minV = Math.min(...flat); let maxV = Math.max(...flat); if (metric === 'mmi') { minV = Math.min(minV, -0.5); maxV = Math.max(maxV, 0.5); }
        const pad = (maxV - minV) === 0 ? 5 : (maxV - minV) * 0.1;
        activeChart = new Chart(ctx, { data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, onClick: (e, el) => { if (candleMode === 'none' && el[0] && el[0].datasetIndex === 0) window.open(`/duels/${chartData[el[0].index].gameId}/summary`, '_blank'); }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(20, 20, 35, 0.95)', padding: 16, titleColor: '#888', titleFont: { size: 12, weight: 'bold' }, bodyColor: '#fff', bodyFont: { size: 14, weight: 'bold' }, borderColor: 'rgba(157, 127, 255, 0.3)', borderWidth: 1, displayColors: true, filter: (item) => (candleMode !== 'none' && metric !== 'gameCount') ? item.datasetIndex !== 0 : true, callbacks: { label: (ctx) => { if (candleMode !== 'none') { const g = ctx.dataset.candleRaw ? ctx.dataset.candleRaw[ctx.dataIndex] : Array.from(candleGroups.values())[ctx.dataIndex]; if (metric === 'gameCount' && ctx.dataset.type === 'bar') return [`Total Games: ${ctx.parsed.y}`]; if (ctx.dataset.label === 'Candle Body') return [`High: ${g.high}`, `Open: ${g.open}`, `Close: ${g.close}`, `Low: ${g.low}`, `Games: ${g.count}`]; } if (ctx.dataset.label === 'Trend') return `Trend: ${ctx.parsed.y.toFixed(1)}`; const val = ctx.parsed.y; const opp = ctx.dataset.opponents?.[ctx.dataIndex] || 'N/A'; const mode = ctx.dataset.modes?.[ctx.dataIndex] || 'N/A'; let text = `${metricLabels[metric].split(' ')[0]}: ${val}`; if (metric === 'mmi') text = `Multi-Merchant Index: ${val} (${val > 0.2 ? "Merchant/Closeness Skill" : (val < -0.2 ? "Merchanted/Distance Penalty" : "Neutral Efficiency")})`; const footer = candleMode === 'none' ? ['', 'Click point for summary'] : []; return [text, `Opponent: ${opp}`, `Mode: ${mode}`, ...footer]; } } } }, scales: { y: { min: metric === 'gameCount' ? 0 : Math.floor(minV - pad), max: Math.ceil(maxV + pad), grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }, ticks: { color: '#888', font: { weight: 'bold' } } }, x: { type: 'category', grid: { display: false }, ticks: { color: '#888', autoSkip: true, maxTicksLimit: 12, font: { weight: 'bold' } } } } } });
    };

    const injectDrawerHistory = (forceRefresh = false) => {
        let root = document.getElementById('history-drawer-root');
        if (!root) {
            root = document.createElement('div'); root.id = 'history-drawer-root';
            root.style.cssText = `position: fixed; left: 0; top: 0; height: 100vh; z-index: 10000; font-family: var(--font-neo-sans, sans-serif); display: flex; align-items: center; pointer-events: none;`;
            const drawer = document.createElement('div'); drawer.id = 'history-drawer';
            const tab = document.createElement('div'); tab.id = 'drawer-trigger-tab'; tab.innerHTML = `<span style="color: white; font-size: 24px; font-weight: 300;">›</span>`;
            drawer.innerHTML = `<div style="padding: 30px 24px; background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.1);"><h2 style="margin:0; font-size: 18px; text-transform: uppercase; letter-spacing: 3px; color: white; display: flex; justify-content: space-between; align-items: center; font-weight: 900;"><span>Match History</span><div style="display: flex; gap: 8px;"><button id="show-graph-btn" style="background: #7952e9; border: none; color: white; font-size: 11px; padding: 8px 16px; border-radius: 10px; cursor: pointer; font-weight: 800;">GRAPH</button></div></h2></div><div id="history-scroll-area" style="overflow-y: auto; flex: 1; padding: 20px; scrollbar-width: thin;"></div>`;
            drawer.querySelector('#show-graph-btn').onclick = (e) => { e.stopPropagation(); showRatingGraph(lastTimeframe, lastMetric, lastTypeFilter, lastModeFilter, lastShowMA, lastCandleMode); };
            root.onmouseenter = () => { drawer.style.transform = 'translateX(0)'; tab.style.opacity = '0'; }; root.onmouseleave = () => { drawer.style.transform = 'translateX(-100%)'; tab.style.opacity = '1'; };
            tab.onmouseenter = root.onmouseenter; root.appendChild(drawer); document.body.appendChild(root); document.body.appendChild(tab); forceRefresh = true;
        }
        const container = document.getElementById('history-scroll-area'); if (!container) return;
        const sorted = [...gameHistory].sort((a, b) => new Date(b.time) - new Date(a.time));
        const curId = window.location.pathname.split('/')[2];
        sorted.forEach((game, index) => {
            let row = document.getElementById(`row-${game.gameId}`); const rc = game.ratingChange || 0;
            const isHydrated = game.hydrated || (game.opponent && game.opponent !== "Loading...");
            const rText = isHydrated ? (rc !== 0 ? (rc > 0 ? '+' : '') + rc : '±0') : '...';
            const rcCol = rc > 0 ? '#4caf50' : (rc < 0 ? '#ff5252' : '#888');
            const modeLabel = (game.isTeamDuel ? 'TEAM ' : '') + (game.mode || 'Moving');
            const contentHTML = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; pointer-events: none;"><div style="display: flex; align-items: center; gap: 10px;"><span style="font-size: 9px; background: rgba(0,0,0,0.4); padding: 4px 10px; border-radius: 6px; font-weight: 900;">${modeLabel}</span>${isHydrated ? `<span style="font-size: 10px; color: ${game.win?'#4caf50':'#ff5252'}; font-weight: 900;">${game.win?'WIN':'LOSS'}</span>` : ''}</div><span style="font-size: 14px; font-weight: 900; color: ${rcCol}">${rText}</span></div><div style="display: flex; justify-content: space-between; align-items: baseline;"><a href="${game.opponentId ? `/user/${game.opponentId}` : '#'}" target="_blank" class="opponent-nick" style="font-size: 17px; font-weight: 800; color: white; text-decoration: none; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${isHydrated ? game.opponent : '<span style="opacity:0.4; font-style:italic;">Syncing...</span>'}</a><span style="font-size: 10px; opacity: 0.5;">${new Date(game.time).toLocaleDateString()}</span></div>`;
            if (!row) { row = document.createElement('div'); row.id = `row-${game.gameId}`; row.className = `history-row ${curId === game.gameId ? 'active' : ''}`; row.innerHTML = contentHTML; row.onclick = (e) => { if (!e.target.classList.contains('opponent-nick')) window.open(`/duels/${game.gameId}/summary`, '_blank'); }; if (index === 0) container.prepend(row); else container.appendChild(row); }
            else { const needsActiveChange = (curId === game.gameId && !row.classList.contains('active')) || (curId !== game.gameId && row.classList.contains('active')); if (row.getAttribute('data-hydrated') !== String(isHydrated) || row.getAttribute('data-mode-label') !== modeLabel || needsActiveChange) { row.innerHTML = contentHTML; row.setAttribute('data-hydrated', isHydrated); row.setAttribute('data-mode-label', modeLabel); if (curId === game.gameId) row.classList.add('active'); else row.classList.remove('active'); } if (container.children[index] !== row) container.insertBefore(row, container.children[index]); }
        });
    };

    interceptNetwork();
    interceptWebSocket();
    fetchRecentGames();
    const observer = new MutationObserver(() => updateUI());
    observer.observe(document.body, { childList: true, subtree: true });
    updateUI(true);
})();