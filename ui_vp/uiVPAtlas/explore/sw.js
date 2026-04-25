// Legacy stub — unregisters itself so the unified root /sw.js takes over
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.registration.unregister());
