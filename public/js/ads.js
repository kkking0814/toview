'use strict';
(async () => {
    const slots = [...document.querySelectorAll('[data-ad-slot]')];
    await Promise.all(slots.map(async (slot) => {
        try {
            const data = await TV.api(`/api/ads/${encodeURIComponent(slot.dataset.adSlot)}`);
            if (!data) return;
            const link = document.createElement('a');
            link.href = `/go/ad/${data.id}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer sponsored';
            const img = document.createElement('img');
            img.src = data.image_url || data.imageUrl;
            img.alt = data.advertiser || '제휴 배너';
            link.append(img);
            slot.replaceChildren(link);
            slot.classList.add('on');
        } catch {
            // 광고 실패는 콘텐츠를 막지 않는다. placeholder 유지.
        }
    }));
})();
