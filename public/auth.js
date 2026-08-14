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

window.addEventListener('DOMContentLoaded', updateAuthUI);
