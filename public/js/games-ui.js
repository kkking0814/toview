'use strict';
window.TVGames = {
    async mount(root, onSelect) {
        const catalog = await TV.api('/api/games');
        const primary = catalog.filter((g) => g.displayGroup === 'primary').slice(0, 5);
        const more = catalog.filter((g) => g.displayGroup === 'more');
        let selected = null;
        let open = false;

        root.classList.add('game-picker');
        root.innerHTML = `
            <div class="game-picker-row" data-game-primary></div>
            <button type="button" class="game-more-toggle" aria-expanded="false">
                <span data-more-label>더보기</span><b>⌄</b>
            </button>
            <div class="game-more-panel" data-game-more hidden></div>
        `;

        const primaryBox = root.querySelector('[data-game-primary]');
        const moreBox = root.querySelector('[data-game-more]');
        const toggle = root.querySelector('.game-more-toggle');
        const label = root.querySelector('[data-more-label]');

        const makeButton = (game) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'game-choice';
            button.dataset.gameId = game.id;
            button.textContent = game.name;
            button.addEventListener('click', async () => {
                selected = game;
                root.querySelectorAll('.game-choice').forEach((el) => el.classList.toggle('on', el.dataset.gameId === game.id));
                const isMore = game.displayGroup === 'more';
                label.textContent = isMore ? game.name : '더보기';
                closeMore();
                const url = new URL(location.href);
                url.searchParams.set('game', game.id);
                history.replaceState(null, '', url);
                await TV.activity().catch(() => {});
                await onSelect?.(game);
            });
            return button;
        };

        primary.forEach((g) => primaryBox.append(makeButton(g)));
        more.forEach((g) => moreBox.append(makeButton(g)));

        function closeMore() {
            open = false;
            moreBox.hidden = true;
            toggle.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        }

        function toggleMore() {
            open = !open;
            moreBox.hidden = !open;
            toggle.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', String(open));
        }

        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMore();
        });
        moreBox.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', closeMore);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeMore();
        });

        root.selectGame = async (id) => {
            const game = catalog.find((g) => g.id === id) || primary[0] || catalog[0];
            if (!game) return null;
            const button = root.querySelector(`[data-game-id="${CSS.escape(game.id)}"]`);
            button?.click();
            return game;
        };
        root.getSelectedGame = () => selected;
        return catalog;
    }
};
