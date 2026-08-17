'use strict';
window.TVAnimation = {
    render(stage, family, state, result, meta = {}) {
        stage.replaceChildren();
        const box = document.createElement('div');
        box.className = `animation-stage state-${String(state).toLowerCase()}`;
        const scene = document.createElement('div');
        scene.className = 'animation-scene';

        if (family === 'ladder') {
            const ladder = document.createElement('div');
            ladder.className = 'anim-ladder';
            ladder.innerHTML = '<i></i><i></i><i></i><span class="runner"></span>';
            if (state === 'RESULT' && result) {
                const label = document.createElement('div');
                label.className = 'animation-result';
                label.textContent = `${result.start === 'left' ? '좌' : '우'} · ${result.lines || '-'}줄 · ${result.oddEven === 'odd' ? '홀' : '짝'}`;
                ladder.append(label);
            }
            scene.append(ladder);
        } else {
            const orbit = document.createElement('div');
            orbit.className = `anim-orbit ${family === 'keno' ? 'keno' : 'ball'}`;
            let values = [];
            if (state === 'RESULT' && result) {
                values = Array.isArray(result.numbers) ? result.numbers.slice(0, family === 'keno' ? 6 : 5) : [];
                if (result.specialNumber != null) values.push(result.specialNumber);
            }
            if (!values.length) values = family === 'keno' ? ['', '', '', '', '', ''] : ['', '', '', '', '', ''];
            values.forEach((value, index) => {
                const ball = document.createElement('span');
                ball.className = `anim-ball${result?.specialNumber != null && index === values.length - 1 ? ' power' : ''}`;
                ball.textContent = value;
                orbit.append(ball);
            });
            scene.append(orbit);
        }

        const caption = document.createElement('div');
        caption.className = 'animation-caption';
        const title = document.createElement('h2');
        const detail = document.createElement('p');
        const titles = { WAITING:'다음 회차 준비 중', DRAWING:'추첨 진행 중', VERIFYING:'결과 확인 중', RESULT:'결과 확정' };
        title.textContent = titles[state] || 'LIVE';
        const roundText = meta.roundNumber ? ` · ${meta.roundNumber}회차` : '';
        const timeText = Number.isFinite(meta.remaining) && meta.remaining > 0 ? ` · ${Math.floor(meta.remaining/60)}:${String(meta.remaining%60).padStart(2,'0')}` : '';
        detail.textContent = `${meta.gameName || 'TOVIEW LIVE'}${roundText}${timeText}`;
        caption.append(title, detail);
        box.append(scene, caption);
        stage.append(box);
    }
};
