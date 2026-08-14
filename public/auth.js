async function updateAuthUI() {
    const button =
        document.getElementById('userBtn') ||
        document.getElementById('loginBtn');

    if (!button) return;

    try {
        const response = await fetch('/api/me', {
            credentials: 'same-origin'
        });

        if (!response.ok) {
            throw new Error('회원정보 확인 실패');
        }

        const user = await response.json();

        // 로그인 상태
        if (user.username) {
            button.textContent =
                (user.nickname || user.username) + ' 님';

            button.onclick = function () {
                location.href = 'dashboard.html';
            };

            return;
        }

        // 로그아웃 상태
        button.textContent = '로그인';

        button.onclick = function () {
            location.href = 'account.html';
        };

    } catch (error) {
        console.error('로그인 상태 확인 오류:', error);

        button.textContent = '로그인';

        button.onclick = function () {
            location.href = 'account.html';
        };
    }
}


async function logoutUser() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'same-origin'
        });

        if (!response.ok) {
            alert('로그아웃에 실패했습니다.');
            return;
        }

        location.href = 'index.html';

    } catch (error) {
        console.error('로그아웃 오류:', error);
        alert('로그아웃 중 오류가 발생했습니다.');
    }
}

function applyAuthButtonStyle() {
    const button =
        document.getElementById('userBtn') ||
        document.getElementById('loginBtn');

    if (!button) return;

    button.style.height = '38px';
    button.style.minWidth = '88px';
    button.style.padding = '0 16px';

    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';

    button.style.background = '#2563eb';
    button.style.color = '#ffffff';

    button.style.border = '1px solid #3b82f6';
    button.style.borderRadius = '8px';

    button.style.fontSize = '13px';
    button.style.fontWeight = '700';
    button.style.whiteSpace = 'nowrap';

    button.style.cursor = 'pointer';
    button.style.boxSizing = 'border-box';
}

window.addEventListener('DOMContentLoaded', () => {
    applyAuthButtonStyle();
    updateAuthUI();
});
