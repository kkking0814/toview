'use strict';
window.TV = {
    async api(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        let body = {};
        try { body = await response.json(); } catch {}
        if (!response.ok) {
            const error = new Error(body.error?.message || `HTTP ${response.status}`);
            error.code = body.error?.code;
            error.status = response.status;
            throw error;
        }
        return body.data;
    },
    qs: (selector) => document.querySelector(selector),
    qsa: (selector) => [...document.querySelectorAll(selector)],
    esc: (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])),
    today: () => {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
        const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        return `${value.year}-${value.month}-${value.day}`;
    },
    gameParam: () => new URLSearchParams(location.search).get('game') || localStorage.getItem('toviewLastGame') || 'dh_randomball',
    setGame(id) {
        localStorage.setItem('toviewLastGame', id);
        const url = new URL(location.href);
        url.searchParams.set('game', id);
        history.replaceState({}, '', url);
    },
    activity() {
        return fetch('/api/activity', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:'{}' });
    }
};
