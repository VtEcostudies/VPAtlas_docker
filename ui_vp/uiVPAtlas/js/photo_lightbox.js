/*
    photo_lightbox.js — Shared photo enlargement modal.

    Usage:
      import { openPhotoLightbox, attachPhotoLightbox } from '/js/photo_lightbox.js';

      // Direct open:
      openPhotoLightbox({ src: '/photos/x.jpg', label: 'Pool' });

      // Auto-wire any image in a container by selector:
      attachPhotoLightbox(container, 'img.photo, .photo-thumb img');
*/

let _injected = false;
let _activeUrl = null;   // blob URL we created (must be revoked)

function injectOnce() {
    if (_injected) return;
    _injected = true;

    let style = document.createElement('style');
    style.textContent = `
        .pl-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.85);
            z-index: 10050; display: none;
            align-items: center; justify-content: center; padding: 12px;
        }
        .pl-overlay.show { display: flex; }
        .pl-box {
            background: #111; border-radius: 8px; max-width: 96vw; max-height: 96vh;
            display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .pl-header {
            display: flex; align-items: center; justify-content: space-between;
            gap: 12px; padding: 8px 12px; color: #fff; background: #222;
            font-size: 14px; font-weight: 500;
        }
        .pl-close {
            background: none; border: none; color: #ddd; font-size: 28px;
            line-height: 1; cursor: pointer; padding: 0 6px;
        }
        .pl-close:hover { color: #fff; }
        .pl-img-wrap {
            background: #000; display: flex; align-items: center; justify-content: center;
            min-height: 200px;
        }
        .pl-img {
            max-width: 96vw; max-height: 75vh; object-fit: contain; display: block;
        }
        .pl-actions {
            display: flex; gap: 8px; padding: 10px; background: #222;
            flex-wrap: wrap; justify-content: center;
        }
        .pl-actions button {
            flex: 1 1 120px; min-height: 44px; padding: 10px 14px;
            border-radius: 6px; border: 1px solid #555; background: #333; color: #fff;
            font-size: 14px; cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        }
        .pl-actions button:hover { background: #3a3a3a; }
        .pl-actions .pl-save { background: #c44100; border-color: #c44100; }
        .pl-actions .pl-delete { background: #dc3545; border-color: #dc3545; }
        .pl-actions button:active { transform: scale(0.98); }
    `;
    document.head.appendChild(style);

    let overlay = document.createElement('div');
    overlay.id = 'pl_overlay';
    overlay.className = 'pl-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
        <div class="pl-box">
            <div class="pl-header">
                <span id="pl_title">Photo</span>
                <button type="button" class="pl-close" id="pl_close" aria-label="Close">&times;</button>
            </div>
            <div class="pl-img-wrap">
                <img id="pl_img" class="pl-img" alt="">
            </div>
            <div class="pl-actions" id="pl_actions"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target.id === 'pl_overlay') closeLightbox();
    });
    document.getElementById('pl_close').addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('show')) closeLightbox();
    });
}

export function closeLightbox() {
    let overlay = document.getElementById('pl_overlay');
    if (overlay) overlay.classList.remove('show');
    if (_activeUrl) { URL.revokeObjectURL(_activeUrl); _activeUrl = null; }
}

/*
    openPhotoLightbox(opts)

    opts = {
        src: string                       // image URL (required, unless `blob` provided)
        blob: Blob|File                   // alternative: a local Blob/File to display
        label: string                     // header text
        downloadName: string              // filename when saving (default: derived)
        onDelete: () => void              // if provided, shows a Delete button
        showSave: boolean (default true)  // show Save-to-device button
    }
*/
export function openPhotoLightbox(opts) {
    injectOnce();
    opts = opts || {};
    let label = opts.label || 'Photo';
    let src = opts.src;
    if (!src && opts.blob) {
        if (_activeUrl) URL.revokeObjectURL(_activeUrl);
        _activeUrl = URL.createObjectURL(opts.blob);
        src = _activeUrl;
    }
    if (!src) return;

    document.getElementById('pl_title').textContent = label;
    document.getElementById('pl_img').src = src;
    document.getElementById('pl_img').alt = label;

    let actions = document.getElementById('pl_actions');
    actions.innerHTML = '';

    let showSave = opts.showSave !== false;
    if (showSave) {
        let btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pl-save';
        btn.innerHTML = '<i class="fa fa-download"></i> Save to device';
        btn.addEventListener('click', async () => {
            let name = opts.downloadName || (opts.blob && opts.blob.name) || deriveName(src, label);
            let blob = opts.blob;
            if (!blob) {
                try {
                    let res = await fetch(src, { credentials: 'omit' });
                    blob = await res.blob();
                } catch(e) {
                    // CORS or fetch failed — fallback to anchor href, browser handles it
                    let a = document.createElement('a');
                    a.href = src; a.download = name; a.target = '_blank';
                    document.body.appendChild(a); a.click(); a.remove();
                    return;
                }
            }
            let shareFile;
            try { shareFile = new File([blob], name, { type: blob.type || 'image/jpeg' }); } catch(_) {}
            if (shareFile && navigator.canShare && navigator.canShare({ files: [shareFile] })) {
                try { await navigator.share({ files: [shareFile], title: name }); return; } catch(e) {
                    if (e.name === 'AbortError') return;
                }
            }
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        actions.appendChild(btn);
    }

    if (typeof opts.onDelete === 'function') {
        let btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pl-delete';
        btn.innerHTML = '<i class="fa fa-trash"></i> Delete';
        btn.addEventListener('click', () => {
            try { opts.onDelete(); } catch(e) { console.warn('lightbox onDelete failed', e); }
            closeLightbox();
        });
        actions.appendChild(btn);
    }

    let cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', closeLightbox);
    actions.appendChild(cancel);

    document.getElementById('pl_overlay').classList.add('show');
}

function deriveName(src, label) {
    try {
        let u = new URL(src, window.location.origin);
        let last = u.pathname.split('/').pop();
        if (last && /\.(jpe?g|png|gif|webp|heic)$/i.test(last)) return last;
    } catch(_) {}
    let safe = (label || 'photo').replace(/[^a-z0-9._-]+/ig, '_');
    return `${safe}.jpg`;
}

/*
    attachPhotoLightbox(root, selector)
    Delegates click on any matching <img> in `root` to open the lightbox using its src + alt.
*/
export function attachPhotoLightbox(root, selector) {
    if (!root) return;
    selector = selector || 'img.photo-thumb, .photo-thumb img, img[data-lightbox]';
    root.addEventListener('click', (e) => {
        let img = e.target.closest(selector);
        if (!img || !root.contains(img)) return;
        // If the image is inside an <a>, prevent navigation
        let a = img.closest('a');
        if (a) e.preventDefault();
        let label = img.dataset.label || img.alt || 'Photo';
        openPhotoLightbox({ src: img.src, label });
    }, true);
}
