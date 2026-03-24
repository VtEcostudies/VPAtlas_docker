/*
    modal.js - Promise-based modal dialog for VPAtlas
    Pattern from LoonWeb modal_options.js
*/

let currentModal = null;

export function showModal(title, message, options = {}) {
    return new Promise((resolve, reject) => {
        if (currentModal) {
            resolve(null);
            return;
        }

        const modal = document.createElement('div');
        modal.classList.add('vp-modal');

        const modalContent = document.createElement('div');
        modalContent.classList.add('vp-modal-content');

        const modalTitle = document.createElement('h2');
        modalTitle.innerHTML = title;
        modalTitle.classList.add('vp-modal-header');

        const modalMessage = document.createElement('div');
        modalMessage.innerHTML = message;
        modalMessage.classList.add('vp-modal-message');

        modalContent.appendChild(modalTitle);
        modalContent.appendChild(modalMessage);

        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add('vp-modal-buttons');

        if (options.buttons) {
            options.buttons.forEach(buttonOptions => {
                const button = document.createElement('button');
                button.textContent = buttonOptions.text;
                if (buttonOptions.isDefault) {
                    button.classList.add('default-button');
                }
                button.addEventListener('click', () => {
                    resolve(buttonOptions.value);
                    modal.remove();
                    currentModal = null;
                });
                buttonContainer.appendChild(button);
            });
        } else {
            // Default OK button
            const button = document.createElement('button');
            button.textContent = 'OK';
            button.classList.add('default-button');
            button.addEventListener('click', () => {
                resolve(true);
                modal.remove();
                currentModal = null;
            });
            buttonContainer.appendChild(button);
        }

        modalContent.appendChild(buttonContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        currentModal = modal;

        // Click outside to dismiss
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                resolve(false);
                modal.remove();
                currentModal = null;
            }
        });
    });
}
