
function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    //container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.className = 'toast-container position-fixed top-0 end-0 p-3 mt-5';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
    return container;
}

// Toast notification system
function showToast(message, type = 'info', location=null) {

    if (typeof message == 'object') {
      if (Object.keys(message).length) {message = JSON.stringify(message);}
      else {message = null;}
    }

    if (!message) { // && !location) {
      console.log('survey_messaging.js=>showToast received empty message without location')
      return;
    }

    if (location) {
      message = `${location}: ${message}`
    }

    const toastContainer = document.getElementById('toast-container') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type === 'error' ? 'danger' : type === 'warning' ? 'warning' : type === 'success' ? 'success' : 'primary'} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
    
    // Remove after hidden
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
}
