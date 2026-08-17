'use strict';
(async () => {
    const tabs = TV.qs('#homeGameTabs');
    const stage = TV.qs('#homeLiveStage');
    const recent = TV.qs('#homeRecent');
    const pattern = TV.qs('#homePattern');
    const stats = TV.qs('#homeStats');
    let catalog = [];
    let currentGame = null;
    let refreshTimer = null;

    const resultLabel = (result = {}) => {
        if (Array.isArray(result.numbers)) {
            const values = [...result.numbers];
            if (result.specialNumber != null) values.push(`P${result.specialNumber}`);
            return values.join(' · ');
        }
        if (result.start) return `${result.start === 'left' ? '좌' : '우'} · ${result.lines || '-'}줄 · ${result.oddEven === 'odd' ? '홀' : '짝'}`;
        return result.oddEven ? `${result.oddEven === 'odd' ? '홀' : '짝'} / ${result.underOver || '-'}` : '결과 확인';
    };

    async function load(game) {
        currentGame = game;
        const id = game.id;
        try {
            const [snap, rows, analysis] = await Promise.all([
                TV.api(`/api/games/${id}/snapshot`),
                TV.api(`/api/games/${id}/results?date=${TV.today()}&limit=20`),
                TV.api(`/api/games/${id}/analysis?days=1`)
            ]);
            const round = snap.currentRound;
            const remaining = round ? Math.ceil((new Date(round.scheduled_at).getTime() - Date.now()) / 1000) : null;
            const state = round ? (remaining > 0 ? 'WAITING' : 'VERIFYING') : (snap.lastResult ? 'RESULT' : 'VERIFYING');
            TVAnimation.render(stage, game.family, state, state === 'RESULT' ? snap.lastResult?.result : null, { gameName: game.name, roundNumber: round?.round_number || snap.lastResult?.roundNumber, remaining });

            recent.innerHTML = rows.length ? rows.slice(0, 5).map((row) => `
                <div class="result-mini-row"><span class="result-mini-round">${row.roundNumber}회</span><span class="result-mini-value">${TV.esc(resultLabel(row.result))}</span></div>
            `).join('') : '<div class="empty">확정 결과를 기다리고 있습니다.</div>';

            pattern.innerHTML = rows.length ? `<div class="pattern-mini">${rows.slice(0, 20).map((row) => `<span title="${row.roundNumber}회">${TV.esc(row.result?.oddEven === 'odd' ? '홀' : row.result?.oddEven === 'even' ? '짝' : row.result?.start === 'left' ? '좌' : row.result?.start === 'right' ? '우' : '·')}</span>`).join('')}</div>` : '<div class="empty">패턴 데이터 대기 중</div>';

            const s = analysis.summary || {};
            stats.innerHTML = `<div class="stat-mini"><div><span>집계 회차</span><b>${s.total || 0}</b></div><div><span>홀</span><b>${s.odd || 0}</b></div><div><span>짝</span><b>${s.even || 0}</b></div></div>`;
        } catch (error) {
            TVAnimation.render(stage, game.family, 'VERIFYING', null, { gameName: game.name });
            recent.innerHTML = '<div class="empty">결과 데이터를 확인하고 있습니다.</div>';
            pattern.innerHTML = '<div class="empty">패턴 데이터를 확인하고 있습니다.</div>';
            stats.innerHTML = '<div class="empty">통계를 확인하고 있습니다.</div>';
        }
    }

    catalog = await TVGames.mount(tabs, load);
    const initial = catalog.find((g) => g.id === TV.gameParam()) || catalog.find((g) => g.displayGroup === 'primary') || catalog[0];
    if (initial) await tabs.selectGame(initial.id);

    const es = new EventSource('/api/events');
    es.addEventListener('game-result', (event) => {
        try {
            const result = JSON.parse(event.data);
            if (result.gameId !== currentGame?.id) return;
            TVAnimation.render(stage, currentGame.family, 'RESULT', result.result, { gameName: currentGame.name, roundNumber: result.roundNumber });
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => load(currentGame), 2200);
        } catch {}
    });
    window.addEventListener('pagehide', () => { es.close(); clearTimeout(refreshTimer); }, { once: true });
})();
