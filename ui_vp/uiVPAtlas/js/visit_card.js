/*
  visit_card.js — Shared tabbed/card renderer for visit detail.

  Used by /explore/visit_view.html and /admin/review_create.html so both
  views show the full visit form data (Visit · Verify · Pool · Species · Photos)
  with consistent layout. Pair with /css/visit_card.css.

  Usage:
    import { renderVisitTabs } from '/js/visit_card.js';
    let handle = renderVisitTabs(container, {
        visit, mapped, photos, reviews,           // data
        extraTabs: [{ id, label, icon, html }]    // optional, e.g. Map
    });
    handle.switchTab('photos');
    handle.onTabChange((tabId) => { ... });
*/

import { formatDate } from '/explore/js/utils.js';
import { openPhotoLightbox } from '/js/photo_lightbox.js';

const SPECIES_KEYS = [
    { name: 'Wood Frog',                photoKey: 'woodfrog',
      adults: 'visitWoodFrogAdults',    eggs: 'visitWoodFrogEgg',  eggHow: 'visitWoodFrogEggHow',
      larvae: 'visitWoodFrogLarvae',    larvaeLabel: 'Tadpoles',
      notes: 'visitWoodFrogNotes',      legacyPhoto: 'visitWoodFrogPhoto', inat: 'visitWoodFrogiNat' },
    { name: 'Spotted Salamander',       photoKey: 'sps',
      adults: 'visitSpsAdults',         eggs: 'visitSpsEgg',       eggHow: 'visitSpsEggHow',
      larvae: 'visitSpsLarvae',         larvaeLabel: 'Larvae',
      notes: 'visitSpsNotes',           legacyPhoto: 'visitSpsPhoto', inat: 'visitSpsiNat' },
    { name: 'Jefferson Salamander',     photoKey: 'jesa',
      adults: 'visitJesaAdults',        eggs: 'visitJesaEgg',      eggHow: 'visitJesaEggHow',
      larvae: 'visitJesaLarvae',        larvaeLabel: 'Larvae',
      notes: 'visitJesaNotes',          legacyPhoto: 'visitJesaPhoto', inat: 'visitJesaiNat' },
    { name: 'Blue-spotted Salamander',  photoKey: 'bssa',
      adults: 'visitBssaAdults',        eggs: 'visitBssaEgg',      eggHow: 'visitBssaEggHow',
      larvae: 'visitBssaLarvae',        larvaeLabel: 'Larvae',
      notes: 'visitBssaNotes',          legacyPhoto: 'visitBssaPhoto', inat: 'visitBssaiNat' },
    { name: 'Fairy Shrimp',             photoKey: 'fairyshrimp',
      adults: 'visitFairyShrimp',       presence: true,
      notes: 'visitFairyShrimpNotes',   legacyPhoto: 'visitFairyShrimpPhoto', inat: 'visitFairyShrimpiNat' },
    { name: 'Fingernail Clams',         photoKey: 'clams',
      adults: 'visitFingerNailClams',   presence: true,
      notes: 'visitFingerNailClamsNotes', legacyPhoto: 'visitFingerNailClamsPhoto', inat: 'visitFingerNailClamsiNat' }
];

function val(v) { return (v != null && v !== '' && v !== 'None' && v !== 'none') ? v : ''; }
function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
function joinList(arr) { return arr.filter(Boolean).join(', '); }

function field(label, value, opts) {
    opts = opts || {};
    let v = val(value);
    if (!v && !opts.showEmpty) return '';
    let cls = 'vc-field' + (opts.full ? ' vc-field-full' : '');
    let valHtml = v ? (opts.html ? v : esc(v)) : '<span class="vc-empty">—</span>';
    return `<div class="${cls}">
        <span class="vc-field-label">${esc(label)}</span>
        <span class="vc-field-value">${valHtml}</span>
    </div>`;
}

function inatLink(url) {
    if (!val(url)) return '';
    return ` <a href="${esc(url)}" target="_blank" title="iNaturalist"><i class="fa fa-external-link-alt" style="font-size:11px;"></i></a>`;
}

function chip(text) { return `<span class="vc-chip">${esc(text)}</span>`; }

// ─── Tab content builders ───────────────────────────────────────────────────

function buildVisitTab(v, m) {
    let poolIdVal = v.visitPoolId || m.mappedPoolId || '';
    let coords = (v.visitLatitude && v.visitLongitude)
        ? `${Number(v.visitLatitude).toFixed(5)}, ${Number(v.visitLongitude).toFixed(5)}`
        : '';

    let html = `<div class="vc-card">
        <div class="vc-card-title"><i class="fa fa-info-circle"></i>Visit Info</div>
        <div class="vc-card-grid">
            ${field('Visit ID', v.visitId)}
            ${field('Pool ID', poolIdVal && `<a href="/explore/pool_view.html?poolId=${encodeURIComponent(poolIdVal)}">${esc(poolIdVal)}</a>`, { html: true })}
            ${field('Date', formatDate(v.visitDate))}
            ${field('Observer', v.visitObserverUserName || v.visitUserName)}
            ${field('Town', v.townName || m.townName)}
            ${field('County', v.countyName || m.countyName)}
            ${field('Created', formatDate(v.visitCreatedAt || v.createdAt))}
            ${field('Updated', formatDate(v.visitUpdatedAt || v.updatedAt))}
        </div>
    </div>`;

    html += `<div class="vc-card">
        <div class="vc-card-title"><i class="fa fa-location-dot"></i>Location</div>
        <div class="vc-card-grid">
            ${field('Pool Located', v.visitLocatePool)}
            ${field('Coordinates', coords)}
            ${field('Coord Source', v.visitCoordSource)}
            ${field('Location Uncertainty (m)', v.visitLocationUncertainty)}
            ${field('Location Notes', v.visitLocationComments, { full: true })}
        </div>
    </div>`;

    let hasLandowner = val(v.visitLandownerName) || val(v.visitLandownerPhone)
        || val(v.visitLandownerEmail) || val(v.visitLandownerAddress)
        || v.visitLandownerPermission != null;
    if (hasLandowner) {
        let perm = v.visitLandownerPermission == null ? ''
            : (v.visitLandownerPermission ? 'Yes' : 'No');
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-user"></i>Landowner</div>
            <div class="vc-card-grid">
                ${field('Permission', perm)}
                ${field('Name', v.visitLandownerName)}
                ${field('Phone', v.visitLandownerPhone)}
                ${field('Email', v.visitLandownerEmail)}
                ${field('Address', v.visitLandownerAddress, { full: true })}
            </div>
        </div>`;
    }
    return html;
}

function buildVerifyTab(v) {
    // Pool type can be radio or JSON array
    let poolType = v.visitPoolType;
    if (val(poolType)) {
        try { let arr = JSON.parse(poolType); if (Array.isArray(arr)) poolType = arr.join(', '); } catch(e) {}
        if (val(v.visitPoolTypeOther)) poolType = poolType + ' — ' + v.visitPoolTypeOther;
    }

    let disturbances = [];
    if (v.visitDisturbDumping) disturbances.push('Dumping');
    if (v.visitDisturbSiltation) disturbances.push('Siltation');
    if (v.visitDisturbVehicleRuts) disturbances.push('Vehicle Ruts');
    if (v.visitDisturbRunoff) disturbances.push('Runoff');
    if (v.visitDisturbDitching) disturbances.push('Ditching');
    if (val(v.visitDisturbOther)) disturbances.push(v.visitDisturbOther);

    let adjacent = [];
    if (v.visitHabitatAgriculture) adjacent.push('Agriculture');
    if (v.visitHabitatLightDev) adjacent.push('Light Development');
    if (v.visitHabitatHeavyDev) adjacent.push('Heavy Development');
    if (v.visitHabitatPavedRd) adjacent.push('Paved Road');
    if (v.visitHabitatDirtRd) adjacent.push('Dirt Road');
    if (v.visitHabitatPowerline) adjacent.push('Powerline');
    if (val(v.visitHabitatOther)) adjacent.push(v.visitHabitatOther);

    let html = `<div class="vc-card">
        <div class="vc-card-title"><i class="fa fa-check-circle"></i>Field Verification</div>
        <div class="vc-card-grid">
            ${field('Vernal Pool?', v.visitVernalPool)}
            ${field('Pool Type', poolType)}
            ${field('Inlet', v.visitInletType)}
            ${field('Outlet', v.visitOutletType)}
        </div>
    </div>`;

    let hasHabitat = val(v.visitForestUpland) || val(v.visitForestCondition)
        || disturbances.length || adjacent.length || val(v.visitHabitatComment);
    if (hasHabitat) {
        let adjHtml = adjacent.map(chip).join(' ');
        let distHtml = disturbances.map(chip).join(' ');
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-tree"></i>Surrounding Habitat</div>
            <div class="vc-card-grid">
                ${field('Forest/Upland', v.visitForestUpland)}
                ${field('Forest Condition', v.visitForestCondition)}
                ${adjHtml ? field('Adjacent Land Use', adjHtml, { full: true, html: true }) : ''}
                ${distHtml ? field('Disturbances', distHtml, { full: true, html: true }) : ''}
                ${field('Habitat Notes', v.visitHabitatComment, { full: true })}
            </div>
        </div>`;
    }
    return html;
}

function buildPoolTab(v) {
    // Substrate: may be string OR JSON array (visit_create stores it as JSON)
    let substrate = v.visitSubstrate;
    if (val(substrate)) {
        try { let arr = JSON.parse(substrate); if (Array.isArray(arr)) substrate = arr.join(', '); } catch(e) {}
        if (val(v.visitSubstrateOther)) substrate = substrate + ' — ' + v.visitSubstrateOther;
    }

    // Vegetation cover — rendered as chips
    let veg = [];
    function vegChip(label, key) {
        let raw = v[key];
        if (raw == null || raw === '') return;
        // Bucket-coded (0..5) values from visit_create radio buttons
        const buckets = ['0%', '1-10%', '11-25%', '26-50%', '51-75%', '≥76%'];
        let label2;
        let n = Number(raw);
        if (Number.isInteger(n) && n >= 0 && n <= 5 && String(raw).length <= 2) {
            label2 = buckets[n];
        } else {
            label2 = String(raw) + (String(raw).endsWith('%') ? '' : '%');
        }
        veg.push(chip(`${label}: ${label2}`));
    }
    vegChip('Trees', 'visitPoolTrees');
    vegChip('Shrubs', 'visitPoolShrubs');
    vegChip('Emergents', 'visitPoolEmergents');
    vegChip('Floating', 'visitPoolFloatingVeg');
    vegChip('Submerged', 'visitSubmergedVeg');

    let html = `<div class="vc-card">
        <div class="vc-card-title"><i class="fa fa-water"></i>Pool Characteristics</div>
        <div class="vc-card-grid">
            ${field('Max Depth', v.visitMaxDepth)}
            ${field('Water Level', v.visitWaterLevelObs)}
            ${field('Hydroperiod', v.visitHydroPeriod)}
            ${field('Max Width (ft)', v.visitMaxWidth)}
            ${field('Max Length (ft)', v.visitMaxLength)}
            ${field('Substrate', substrate)}
        </div>
    </div>`;

    if (veg.length) {
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-leaf"></i>Vegetation Cover</div>
            <div>${veg.join(' ')}</div>
        </div>`;
    }

    if (val(v.visitPoolCharComments)) {
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-comment"></i>Comments</div>
            <div class="vc-field-value" style="white-space:pre-wrap;">${esc(v.visitPoolCharComments)}</div>
        </div>`;
    }
    return html;
}

function buildSpeciesTab(v, photosByType) {
    let cards = [];
    SPECIES_KEYS.forEach(s => {
        let adults = Number(v[s.adults] || 0);
        let eggs = s.eggs ? Number(v[s.eggs] || 0) : 0;
        let larvae = s.larvae ? Number(v[s.larvae] || 0) : 0;
        // Skip if all zero & no notes & no photos
        let hasPhotos = (photosByType[s.photoKey] && photosByType[s.photoKey].length) || val(v[s.legacyPhoto]);
        if (!adults && !eggs && !larvae && !val(v[s.notes]) && !hasPhotos) return;

        let pills = [];
        if (s.presence) {
            pills.push(`<span class="vc-count-pill ${adults ? 'vc-pill-pos' : ''}">
                <span class="vc-count-label">Status</span>
                <span class="vc-count-val">${adults ? 'Present' : 'Not Present'}</span>
            </span>`);
        } else {
            pills.push(`<span class="vc-count-pill ${adults > 0 ? 'vc-pill-pos' : ''}">
                <span class="vc-count-label">Adults</span>
                <span class="vc-count-val">${adults}</span>
            </span>`);
            let eggHow = val(v[s.eggHow]);
            pills.push(`<span class="vc-count-pill ${eggs > 0 ? 'vc-pill-pos' : ''}">
                <span class="vc-count-label">Eggs</span>
                <span class="vc-count-val">${eggs}${eggHow ? ` (${esc(eggHow)})` : ''}</span>
            </span>`);
            pills.push(`<span class="vc-count-pill ${larvae > 0 ? 'vc-pill-pos' : ''}">
                <span class="vc-count-label">${esc(s.larvaeLabel)}</span>
                <span class="vc-count-val">${larvae > 0 ? (s.larvae && larvae === 1 ? 'Present' : larvae) : '0'}</span>
            </span>`);
        }

        let nameHtml = esc(s.name) + inatLink(v[s.inat]);
        let card = `<div class="vc-species-card">
            <div class="vc-species-name">${nameHtml}</div>
            <div class="vc-species-counts">${pills.join('')}</div>
            ${val(v[s.notes]) ? `<div class="vc-species-notes">${esc(v[s.notes])}</div>` : ''}
            ${renderPhotoGroup(photosByType[s.photoKey], v[s.legacyPhoto])}
        </div>`;
        cards.push(card);
    });

    // Other species (free-form)
    if (val(v.visitSpeciesOtherName) || Number(v.visitSpeciesOtherCount || 0) > 0
        || val(v.visitSpeciesOtherNotes) || (photosByType.other && photosByType.other.length)) {
        let count = Number(v.visitSpeciesOtherCount || 0);
        let nameHtml = esc(val(v.visitSpeciesOtherName) || 'Other Species') + inatLink(v.visitSpeciesOtheriNat);
        cards.push(`<div class="vc-species-card">
            <div class="vc-species-name">${nameHtml}</div>
            <div class="vc-species-counts">
                <span class="vc-count-pill ${count ? 'vc-pill-pos' : ''}">
                    <span class="vc-count-label">Count</span>
                    <span class="vc-count-val">${count}</span>
                </span>
            </div>
            ${val(v.visitSpeciesOtherNotes) ? `<div class="vc-species-notes">${esc(v.visitSpeciesOtherNotes)}</div>` : ''}
            ${renderPhotoGroup(photosByType.other, v.visitSpeciesOtherPhoto)}
        </div>`);
    }

    let html = '';
    if (cards.length) {
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-frog"></i>Indicator Species</div>
            <div class="vc-species-grid">${cards.join('')}</div>
        </div>`;
    }

    // Amphibian disease (sits above Fish in the form, mirror that order here)
    if (v.visitAmphibianDisease != null && v.visitAmphibianDisease !== '') {
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-virus"></i>Amphibian Disease</div>
            <div class="vc-card-grid">
                ${field('Signs Observed', v.visitAmphibianDisease ? 'Yes' : 'No')}
            </div>
        </div>`;
    }

    // Fish
    let fishItems = [];
    if (v.visitFish != null && v.visitFish !== '') fishItems.push(['Fish Present', v.visitFish ? 'Yes' : 'No']);
    if (val(v.visitFishCount)) fishItems.push(['Fish Count', v.visitFishCount]);
    if (val(v.visitFishSize)) fishItems.push(['Fish Size', v.visitFishSize]);
    if (v.visitFishSizeSmall) fishItems.push(['Small', v.visitFishSizeSmall]);
    if (v.visitFishSizeMedium) fishItems.push(['Medium', v.visitFishSizeMedium]);
    if (v.visitFishSizeLarge) fishItems.push(['Large', v.visitFishSizeLarge]);
    if (fishItems.length) {
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-fish"></i>Fish</div>
            <div class="vc-card-grid">
                ${fishItems.map(([l, vv]) => field(l, vv)).join('')}
            </div>
        </div>`;
    }

    if (val(v.visitSpeciesComments)) {
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-comment"></i>Species Notes</div>
            <div class="vc-field-value" style="white-space:pre-wrap;">${esc(v.visitSpeciesComments)}</div>
        </div>`;
    }

    if (!html) {
        html = `<div class="vc-empty-msg">No species data recorded.</div>`;
    }
    return html;
}

function renderPhotoGroup(photos, legacyUrl) {
    let arr = (photos && photos.length) ? photos.slice() : [];
    if (legacyUrl && val(legacyUrl)) {
        // Legacy single-photo column — append if not already a /photos/ url present
        let exists = arr.some(p => p.visitPhotoUrl === legacyUrl || p.visitPhotoUrl === '/' + legacyUrl);
        if (!exists) arr.push({ visitPhotoUrl: legacyUrl, visitPhotoSpecies: '' });
    }
    if (!arr.length) return '';
    return `<div class="vc-photo-group">
        <div class="vc-photo-grid">${arr.map(photoThumbHtml).join('')}</div>
    </div>`;
}

function photoThumbHtml(p) {
    let apiBase = (typeof appConfig !== 'undefined' && appConfig.api && appConfig.api.fqdn) || '';
    let raw = p.visitPhotoUrl || '';
    let url = raw.startsWith('http') ? raw : (apiBase + (raw.startsWith('/') ? raw : '/' + raw));
    let label = p.visitPhotoSpecies || 'Photo';
    return `<button type="button" class="vc-photo-thumb" data-src="${esc(url)}" data-label="${esc(label)}" title="${esc(label)}">
        <img src="${esc(url)}" alt="${esc(label)}" loading="lazy">
        <span class="vc-photo-thumb-label">${esc(label)}</span>
    </button>`;
}

function buildPhotosTab(photos, photosByType, v) {
    if (!photos || !photos.length) {
        return `<div class="vc-empty-msg">No photos for this visit.</div>`;
    }
    // Group by visitPhotoSpecies, label nicely
    const TYPE_LABELS = {
        pool: 'Pool', vegetation: 'Vegetation',
        woodfrog: 'Wood Frog', sps: 'Spotted Salamander',
        jesa: 'Jefferson Salamander', bssa: 'Blue-spotted Salamander',
        fairyshrimp: 'Fairy Shrimp', clams: 'Fingernail Clams',
        other: 'Other Species'
    };
    let order = ['pool', 'vegetation', 'woodfrog', 'sps', 'jesa', 'bssa', 'fairyshrimp', 'clams', 'other'];
    let seen = new Set();
    let html = '';
    order.forEach(k => {
        let arr = photosByType[k];
        if (!arr || !arr.length) return;
        seen.add(k);
        let title = TYPE_LABELS[k] || k;
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-camera"></i>${esc(title)} <span style="font-weight:400; color:var(--text-muted);">(${arr.length})</span></div>
            <div class="vc-photo-grid">${arr.map(photoThumbHtml).join('')}</div>
        </div>`;
    });
    // Any remaining (unknown types)
    Object.keys(photosByType).forEach(k => {
        if (seen.has(k)) return;
        let arr = photosByType[k];
        if (!arr || !arr.length) return;
        let title = TYPE_LABELS[k] || k || 'Other';
        html += `<div class="vc-card">
            <div class="vc-card-title"><i class="fa fa-camera"></i>${esc(title)} <span style="font-weight:400; color:var(--text-muted);">(${arr.length})</span></div>
            <div class="vc-photo-grid">${arr.map(photoThumbHtml).join('')}</div>
        </div>`;
    });
    return html;
}

function buildReviewsTab(reviews) {
    if (!reviews || !reviews.length) {
        return `<div class="vc-empty-msg">No reviews for this visit.</div>`;
    }
    let html = `<div class="vc-card">
        <div class="vc-card-title"><i class="fa fa-clipboard-check"></i>Reviews <span style="font-weight:400; color:var(--text-muted);">(${reviews.length})</span></div>`;
    reviews.forEach(r => {
        html += `<div class="vc-review-card" data-review-id="${esc(r.reviewId || '')}">
            <div class="vc-field"><span class="vc-field-label">ID</span><span class="vc-field-value">${esc(r.reviewId || '')}</span></div>
            <div class="vc-field"><span class="vc-field-label">Date</span><span class="vc-field-value">${esc(formatDate(r.reviewQADate))}</span></div>
            <div class="vc-field"><span class="vc-field-label">QA Code</span><span class="vc-field-value">${esc(r.reviewQACode || '')}</span></div>
            <div class="vc-field"><span class="vc-field-label">Reviewer</span><span class="vc-field-value">${esc(r.reviewUserName || '')}</span></div>
        </div>`;
    });
    html += `</div>`;
    return html;
}

// ─── Main entry point ──────────────────────────────────────────────────────

export function renderVisitTabs(container, opts) {
    opts = opts || {};
    let v = opts.visit || {};
    let m = opts.mapped || {};
    let photos = Array.isArray(opts.photos) ? opts.photos : [];
    let reviews = opts.reviews || null;
    let extraTabs = Array.isArray(opts.extraTabs) ? opts.extraTabs : [];
    let initial = opts.initialTab || 'visit';

    // Group photos by species/type
    let photosByType = {};
    photos.forEach(p => {
        let k = (p.visitPhotoSpecies || 'other').toLowerCase();
        (photosByType[k] = photosByType[k] || []).push(p);
    });

    let tabs = [
        { id: 'visit',   label: 'Visit',   icon: 'fa-info-circle', html: buildVisitTab(v, m) },
        { id: 'verify',  label: 'Verify',  icon: 'fa-check-circle', html: buildVerifyTab(v) },
        { id: 'pool',    label: 'Pool',    icon: 'fa-water',       html: buildPoolTab(v) },
        { id: 'species', label: 'Species', icon: 'fa-frog',        html: buildSpeciesTab(v, photosByType) },
        { id: 'photos',  label: 'Photos',  icon: 'fa-camera',      html: buildPhotosTab(photos, photosByType, v),
          badge: photos.length || null }
    ];
    if (reviews) {
        tabs.push({ id: 'reviews', label: 'Reviews', icon: 'fa-clipboard-check',
                    html: buildReviewsTab(reviews), badge: reviews.length || null });
    }
    extraTabs.forEach(t => tabs.push(t));

    let tabBarHtml = tabs.map(t => {
        let badge = t.badge ? `<span class="vc-tab-badge">${t.badge}</span>` : '';
        return `<button type="button" class="vc-tab" data-vc-tab="${t.id}">
            <i class="fa ${t.icon}"></i>
            <span>${esc(t.label)}${badge}</span>
        </button>`;
    }).join('');

    let panelsHtml = tabs.map(t => `<div class="vc-panel" data-vc-panel="${t.id}">${t.html || ''}</div>`).join('');

    container.classList.add('vc-root');
    container.innerHTML = `<div class="vc-tabs">${tabBarHtml}</div>${panelsHtml}`;

    let onChangeFns = [];

    function switchTab(id) {
        let found = false;
        container.querySelectorAll('.vc-tab').forEach(b => {
            let active = b.dataset.vcTab === id;
            b.classList.toggle('active', active);
            if (active) found = true;
        });
        container.querySelectorAll('.vc-panel').forEach(p =>
            p.classList.toggle('active', p.dataset.vcPanel === id));
        if (found) onChangeFns.forEach(fn => { try { fn(id); } catch(e) {} });
    }

    container.querySelectorAll('.vc-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.vcTab));
    });

    // Photo lightbox wiring (within all panels)
    container.addEventListener('click', (e) => {
        let thumb = e.target.closest('.vc-photo-thumb');
        if (thumb) {
            openPhotoLightbox({ src: thumb.dataset.src, label: thumb.dataset.label });
        }
    });

    // Review row click → review_view
    container.addEventListener('click', (e) => {
        let row = e.target.closest('.vc-review-card');
        if (row && row.dataset.reviewId) {
            window.location.href = '/admin/review_view.html?reviewId=' + encodeURIComponent(row.dataset.reviewId);
        }
    });

    switchTab(initial);

    return {
        switchTab,
        onTabChange(fn) { if (typeof fn === 'function') onChangeFns.push(fn); },
        getPanel(id) { return container.querySelector(`.vc-panel[data-vc-panel="${id}"]`); }
    };
}
