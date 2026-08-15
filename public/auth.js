// ========================================
// TOVIEW AUTH.JS — 2026-08 통합본
// common.css / index / results / analysis / account / dashboard 공통
// server.js: /api/me, /api/logout 기준
// ========================================

(function () {
    'use strict';

    let currentUser = null;
    let authChecked = false;

    function getLoginButton() {
        return document.getElementById('loginBtn');
    }

    function getUserButton() {
        return document.getElementById('userBtn');
    }

    function setLoggedOutUI() {
        currentUser = null;

        const loginBtn = getLoginButton();
        const userBtn = getUserButton();

        if (loginBtn) {
            loginBtn.hidden = false;
            loginBtn.textContent = '로그인';
            loginBtn.onclick = function () {
                location.href = 'account.html?next=' +
                    encodeURIComponent(location.pathname + location.search + location.hash);
            };
        }

        if (userBtn) {
            userBtn.hidden = true;
            userBtn.textContent = '내 계정';
            userBtn.onclick = function () {
                location.href = 'dashboard.html';
            };
        }
    }

    function setLoggedInUI(user) {
        currentUser = user;

        const loginBtn = getLoginButton();
        const userBtn = getUserButton();
        const displayName = user.nickname || user.username || '회원';

        // 최신 페이지처럼 loginBtn / userBtn이 둘 다 존재하는 경우
        if (loginBtn && userBtn) {
            loginBtn.hidden = true;

            userBtn.hidden = false;
            userBtn.textContent = displayName + ' 님';
            userBtn.onclick = function () {
                location.href = 'dashboard.html';
            };

            return;
        }

        // 이전 페이지 호환: 버튼이 하나만 있는 경우에도 정상 작동
        const singleButton = userBtn || loginBtn;

        if (singleButton) {
            singleButton.hidden = false;
            singleButton.textContent = displayName + ' 님';
            singleButton.onclick = function () {
                location.href = 'dashboard.html';
            };
        }
    }

    async function updateAuthUI() {
        try {
            const response = await fetch('/api/me', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json'
                }
            });

            // 비로그인 상태를 콘솔 오류처럼 처리하지 않는다.
            if (response.status === 401 || response.status === 403) {
                setLoggedOutUI();
                authChecked = true;
                return null;
            }

            if (!response.ok) {
                throw new Error('회원정보 확인 실패 (' + response.status + ')');
            }

            let user = null;

            try {
                user = await response.json();
            } catch {
                throw new Error('회원정보 응답 형식 오류');
            }

            if (user && user.username) {
                setLoggedInUI(user);
            } else {
                setLoggedOutUI();
            }

            authChecked = true;
            return currentUser;

        } catch (error) {
            console.error('로그인 상태 확인 오류:', error);

            setLoggedOutUI();
            authChecked = true;
            return null;
        }
    }

    async function logoutUser() {
        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                let message = '로그아웃에 실패했습니다.';

                try {
                    const data = await response.json();
                    message = data.error || data.message || message;
                } catch {}

                alert(message);
                return false;
            }

            setLoggedOutUI();
            location.href = 'index.html';
            return true;

        } catch (error) {
            console.error('로그아웃 오류:', error);
            alert('로그아웃 중 서버 연결 오류가 발생했습니다.');
            return false;
        }
    }

    function getCurrentUser() {
        return currentUser;
    }

    function isAuthChecked() {
        return authChecked;
    }

    // 다른 페이지의 스크립트에서도 사용할 수 있도록 공개
    window.updateAuthUI = updateAuthUI;
    window.logoutUser = logoutUser;
    window.getCurrentUser = getCurrentUser;
    window.isAuthChecked = isAuthChecked;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateAuthUI, { once: true });
    } else {
        updateAuthUI();
    }

    // 뒤로가기/앞으로가기로 페이지가 복원될 때 세션 UI 재확인
    window.addEventListener('pageshow', function (event) {
        if (event.persisted) {
            updateAuthUI();
        }
    });
})();
