// survey_state.js - Centralized state management for VPAtlas Survey
// Manages a single survey: GPS tracking, observations, and survey metadata.
// Modeled on LoonWeb's SurveyState class with async constructor pattern.
// Lists of surveys are managed in find_pool.html.

class SurveyState {

    constructor(survey_init={}) {
      console.log('SurveyState constructor', survey_init);

      // Async constructor pattern: return Promise that resolves to `this`.
      // Caller: let state = await new SurveyState({...});
      return new Promise((resolve, reject) => {
        if (survey_init.survey_uuid) {
            this.loadState(survey_init).then(() => {resolve(this)}).catch(err => {reject(err)});
        } else {
            this.initState(survey_init).then(() => {resolve(this)}).catch(err => {reject(err)});
        }
      })
    } //end constructor

    // ---- IndexedDB helpers using idb-keyval pattern ----
    // VPAtlas stores surveys keyed as 'vpatlas-survey-<uuid>'
    static get DB_NAME() { return 'VPAtlas'; }
    static get STORE_NAME() { return 'store'; }

    static idbKey(uuid) {
      return 'vpatlas-survey-' + uuid;
    }

    async idbGet(key) {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(SurveyState.DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(SurveyState.STORE_NAME)) {
            db.createObjectStore(SurveyState.STORE_NAME);
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(SurveyState.STORE_NAME, 'readonly');
          const store = tx.objectStore(SurveyState.STORE_NAME);
          const getReq = store.get(key);
          getReq.onsuccess = () => resolve(getReq.result);
          getReq.onerror = () => reject(getReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    }

    async idbSet(key, value) {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(SurveyState.DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(SurveyState.STORE_NAME)) {
            db.createObjectStore(SurveyState.STORE_NAME);
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(SurveyState.STORE_NAME, 'readwrite');
          const store = tx.objectStore(SurveyState.STORE_NAME);
          const putReq = store.put(value, key);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
          tx.oncomplete = () => resolve();
        };
        req.onerror = () => reject(req.error);
      });
    }

    async idbKeys() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(SurveyState.DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(SurveyState.STORE_NAME)) {
            db.createObjectStore(SurveyState.STORE_NAME);
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(SurveyState.STORE_NAME, 'readonly');
          const store = tx.objectStore(SurveyState.STORE_NAME);
          const keysReq = store.getAllKeys();
          keysReq.onsuccess = () => resolve(keysReq.result);
          keysReq.onerror = () => reject(keysReq.error);
        };
        req.onerror = () => reject(req.error);
      });
    }

    // ---- Load existing survey from IndexedDB ----
    async loadState(survey_init={}) {
      try {
        let survey_uuid = survey_init.survey_uuid;
        if (!survey_uuid) throw new Error('No survey_uuid provided to loadState()');

        let survey = await this.idbGet(SurveyState.idbKey(survey_uuid));
        console.log('survey_state.js=>loadState', survey_uuid, survey);

        if (survey) {
            this.state = survey;
            // Apply ephemeral overrides from caller
            if (survey_init.gps_interval) { this.state.gpsTracking.interval = survey_init.gps_interval; }
            if (survey_init.gps_simulate === 'true' || survey_init.gps_simulate === true) {
              this.state.gpsTracking.simulate = [0.0001, 0.0001];
            }
            // Backwards compatibility: ensure observation.time
            for (var obs of this.state.observations) {
              if (!obs.time && obs.timestamp) { obs.time = obs.timestamp; }
            }
            console.log('survey_state.js=>loadState loaded', this.state);
        } else {
            console.error('survey_state.js=>loadState survey_uuid NOT found', survey_uuid);
            throw new Error(`Survey UUID ${survey_uuid} not found`);
        }
      } catch (err) {
          console.error('survey_state.js=>loadState failed', err);
          throw err;
      }
    }

    // ---- Initialize new survey state ----
    async initState(survey_init={}) {
        this.state = {
            survey_uuid: this.generateSurveyUuid(),
            poolId: survey_init.pool_id ?? null,
            surveyType: survey_init.survey_type ?? null, // 'visit' | 'monitor'
            observer: survey_init.observer ?? null,

            survey_date: survey_init.date ?? this.getDateNow(),
            start_time: survey_init.time ?? this.getTimeNow(),
            stop_time: null,
            elapsed_last_timestamp: new Date().toISOString(),
            elapsedTime: 0, // seconds

            status: 'draft', // draft, complete, uploaded
            last_modified: new Date().toISOString(),

            // VPAtlas-specific: visit data
            visit_data: {
                waterLevel: null,
                canopyCover: null,
                speciesPresent: [] // array of species keys
            },

            // VPAtlas-specific: monitoring data
            monitor_data: {
                equipment: { dipNetSweeps: 0, trapCount: 0 },
                amphibians: { eggMasses: 0, larvae: 0, adults: 0 },
                macroinvertebrates: { fairyShrimp: 0, caddisflyLarvae: 0 }
            },

            observations: [], // point observations with lat/lng

            survey_notes: null,

            gpsTracking: {
                paused: false,
                enabled: survey_init.gps_track === 'true' || survey_init.gps_track === true,
                simulate: (survey_init.gps_simulate === 'true' || survey_init.gps_simulate === true)
                          ? [0.0001, 0.0001] : false,
                interval: survey_init.gps_interval ?? 1000,
                threshold_meters: survey_init.meters ?? 3,
                threshold_seconds: survey_init.seconds ?? 3,
                accuracy_threshold: survey_init.gps_accuracy_threshold ?? 20,
                trackPoints: [], // array of {lat, lng, timestamp, accuracy}
                totalDistance: 0, // meters
                lastLocation: null
            }
        };

        this.surveyInterval = false;
        this.gpsInterval = false;

        // Auto-save every 30 seconds
        if (typeof resourceManager !== 'undefined') {
            this.autoSaveInterval = resourceManager.setInterval(() => this.saveState(), 30000);
        } else {
            this.autoSaveInterval = setInterval(() => this.saveState(), 30000);
        }

        // Initial save
        await this.saveState();
        console.log('survey_state.js=>initState created', this.state.survey_uuid);
    }

    // ---- Persistence ----
    async saveState() {
      try {
        this.state.last_modified = new Date().toISOString();
        await this.idbSet(SurveyState.idbKey(this.state.survey_uuid), this.state);
        console.log('survey_state.js=>saveState saved', this.state.survey_uuid);
      } catch (err) {
        console.error('survey_state.js=>saveState failed', err);
      }
    }

    // ---- Observations ----
    addObservation(obs) {
      if (!obs.time) { obs.time = new Date().toISOString(); }
      if (!obs.id) { obs.id = this.generateObsId(); }
      this.state.observations.push(obs);
      this.saveState();
      console.log('survey_state.js=>addObservation', obs);
      return obs;
    }

    removeObservation(obsId) {
      this.state.observations = this.state.observations.filter(o => o.id !== obsId);
      this.saveState();
    }

    // ---- GPS Track Points ----
    addTrackPoint(lat, lng, accuracy, timestamp) {
      const point = {
        lat: lat,
        lng: lng,
        accuracy: accuracy ?? null,
        timestamp: timestamp ?? new Date().toISOString()
      };

      // Calculate distance from last point
      const last = this.state.gpsTracking.lastLocation;
      if (last) {
        const dist = this.haversineDistance(last.lat, last.lng, lat, lng);
        this.state.gpsTracking.totalDistance += dist;
      }

      this.state.gpsTracking.trackPoints.push(point);
      this.state.gpsTracking.lastLocation = point;
      return point;
    }

    // ---- Elapsed Time ----
    getElapsedTime() {
      return this.state.elapsedTime;
    }

    updateElapsedTime() {
      const now = new Date();
      const last = new Date(this.state.elapsed_last_timestamp);
      const delta = (now - last) / 1000;
      this.state.elapsedTime += delta;
      this.state.elapsed_last_timestamp = now.toISOString();
      return this.state.elapsedTime;
    }

    getElapsedTimeFormatted() {
      const total = Math.floor(this.state.elapsedTime);
      const hrs = Math.floor(total / 3600);
      const mins = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      }
      return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }

    // ---- Utility ----
    generateSurveyUuid() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    generateObsId() {
      return 'obs-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    }

    getDateNow() {
      return new Date().toISOString().slice(0, 10);
    }

    getTimeNow() {
      return new Date().toTimeString().slice(0, 5);
    }

    haversineDistance(lat1, lon1, lat2, lon2) {
      const R = 6371000; // meters
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }

    // ---- Cleanup ----
    destroy() {
      if (this.autoSaveInterval) {
        if (typeof resourceManager !== 'undefined') {
          resourceManager.clearInterval(this.autoSaveInterval);
        } else {
          clearInterval(this.autoSaveInterval);
        }
      }
      this.saveState(); // final save
    }
}
