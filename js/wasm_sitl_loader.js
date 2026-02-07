'use strict';

/**
 * WASM SITL Module Loader
 *
 * Loads and initializes the INAV SITL (Software In The Loop) WebAssembly module
 * for running flight controller firmware directly in the browser.
 *
 * Architecture:
 * - Loads SITL.wasm (compiled firmware) and SITL.elf (Emscripten glue code)
 * - Initializes Emscripten runtime with browser-compatible settings
 * - Provides serial byte interface (serialWriteByte/serialReadByte/serialAvailable)
 * - MSP communication uses the standard serial layer via ConnectionWasm
 * - Persists settings to IndexedDB for retention across page reloads
 * - Handles errors gracefully with user-friendly messages
 *
 * Usage: See ConnectionWasm for the connection interface.
 */

// IndexedDB constants
const EEPROM_DB_NAME = 'inav-wasm-sitl';
const EEPROM_DB_VERSION = 1;
const EEPROM_STORE_NAME = 'eeprom';
const EEPROM_KEY = 'eepromData';

class WasmSitlLoader {

    constructor() {
        this._module = null;
        this._scriptTag = null;  // Track script tag so we can remove it on reload
        this._isLoaded = false;
        this._isLoading = false;
        this._loadError = null;
        this._dataCallback = null;
        this._rebootCallback = null;
        this._reconnectCallback = null;
        this._db = null;  // IndexedDB database handle
    }

    /**
     * Check if WASM is supported in this browser
     * @returns {boolean} true if WebAssembly is available
     */
    static isWasmSupported() {
        return typeof WebAssembly === 'object'
            && typeof WebAssembly.instantiate === 'function';
    }

    // =========================================================================
    // IndexedDB Persistence Methods
    // =========================================================================

    /**
     * Open IndexedDB database for EEPROM persistence
     * @private
     * @returns {Promise<IDBDatabase>}
     */
    async _openDatabase() {
        if (this._db) {
            return this._db;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(EEPROM_DB_NAME, EEPROM_DB_VERSION);

            request.onerror = () => {
                console.error('[WASM SITL] Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this._db = request.result;
                console.log('[WASM SITL] IndexedDB opened successfully');
                resolve(this._db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(EEPROM_STORE_NAME)) {
                    db.createObjectStore(EEPROM_STORE_NAME);
                    console.log('[WASM SITL] Created EEPROM object store');
                }
            };
        });
    }

    /**
     * Load stored EEPROM data from IndexedDB
     * @private
     * @returns {Promise<Uint8Array|null>} Stored data or null if not found
     */
    async _loadStoredEeprom() {
        try {
            const db = await this._openDatabase();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(EEPROM_STORE_NAME, 'readonly');
                const store = transaction.objectStore(EEPROM_STORE_NAME);
                const request = store.get(EEPROM_KEY);

                request.onerror = () => {
                    console.warn('[WASM SITL] Failed to load stored EEPROM:', request.error);
                    resolve(null);
                };

                request.onsuccess = () => {
                    if (request.result) {
                        // IndexedDB returns ArrayBuffer, which has byteLength not length
                        const arrayBuffer = request.result;
                        const data = new Uint8Array(arrayBuffer);
                        console.log('[WASM SITL] Loaded stored EEPROM data:', data.length, 'bytes');
                        resolve(data);
                    } else {
                        console.log('[WASM SITL] No stored EEPROM data found');
                        resolve(null);
                    }
                };
            });
        } catch (error) {
            console.warn('[WASM SITL] Error loading stored EEPROM:', error);
            return null;
        }
    }

    /**
     * Save EEPROM data to IndexedDB
     * @private
     * @param {Uint8Array} data - EEPROM data to store
     * @returns {Promise<void>}
     */
    async _saveEepromToStorage(data) {
        try {
            const db = await this._openDatabase();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(EEPROM_STORE_NAME, 'readwrite');
                const store = transaction.objectStore(EEPROM_STORE_NAME);
                const request = store.put(data.buffer, EEPROM_KEY);

                request.onerror = () => {
                    console.error('[WASM SITL] Failed to save EEPROM to IndexedDB:', request.error);
                    reject(request.error);
                };

                request.onsuccess = () => {
                    console.log('[WASM SITL] EEPROM saved to IndexedDB:', data.length, 'bytes');
                    resolve();
                };
            });
        } catch (error) {
            console.error('[WASM SITL] Error saving EEPROM:', error);
        }
    }

    /**
     * Read EEPROM data from WASM memory
     * @private
     * @returns {Uint8Array|null} EEPROM data or null if module not loaded
     */
    _readEepromFromWasm() {
        if (!this._module || typeof this._module._wasmGetEepromPtr !== 'function') {
            return null;
        }

        const ptr = this._module._wasmGetEepromPtr();
        const size = this._module._wasmGetEepromSize();

        if (!ptr || !size) {
            console.warn('[WASM SITL] Invalid EEPROM pointer or size');
            return null;
        }

        // Read from WASM heap
        return new Uint8Array(this._module.HEAPU8.buffer, ptr, size).slice();
    }

    /**
     * Write EEPROM data to WASM memory and reload config
     * @private
     * @param {Uint8Array} data - EEPROM data to write
     * @returns {boolean} true if successful
     */
    _writeEepromToWasm(data) {
        if (!this._module || typeof this._module._wasmGetEepromPtr !== 'function') {
            return false;
        }

        const ptr = this._module._wasmGetEepromPtr();
        const size = this._module._wasmGetEepromSize();

        if (!ptr || !size) {
            console.warn('[WASM SITL] Invalid EEPROM pointer or size');
            return false;
        }

        if (data.length !== size) {
            console.warn('[WASM SITL] EEPROM size mismatch:', data.length, 'vs', size);
            return false;
        }

        // Write to WASM heap
        this._module.HEAPU8.set(data, ptr);
        console.log('[WASM SITL] Wrote', data.length, 'bytes to WASM EEPROM');

        // Reload config from the injected data
        if (typeof this._module._wasmReloadConfig === 'function') {
            const valid = this._module._wasmReloadConfig();
            console.log('[WASM SITL] Config reload result:', valid ? 'success' : 'invalid data');
            return valid;
        }

        return true;
    }

    /**
     * Load the WASM SITL module
     * @returns {Promise<object>} Initialized Emscripten Module
     * @throws {Error} If WASM is not supported or loading fails
     */
    async load() {
        if (this._isLoaded) {
            console.log('[WASM SITL] Module already loaded');
            return this._module;
        }

        if (this._isLoading) {
            throw new Error('Module is already being loaded');
        }

        if (!WasmSitlLoader.isWasmSupported()) {
            const error = new Error('WebAssembly is not supported in this browser. Please use a modern browser (Chrome 57+, Firefox 52+, Safari 11+, or Edge 16+).');
            this._loadError = error;
            throw error;
        }

        this._isLoading = true;
        this._loadError = null;

        try {
            console.log('[WASM SITL] Starting module load...');

            // Pre-load stored EEPROM data from IndexedDB
            const storedEeprom = await this._loadStoredEeprom();

            // Load the Emscripten glue code (SITL.elf is actually a .js file)
            const module = await this._loadEmscriptenGlue(storedEeprom);

            console.log('[WASM SITL] Module loaded successfully');
            this._module = module;
            this._isLoaded = true;
            this._isLoading = false;

            return module;

        } catch (error) {
            console.error('[WASM SITL] Failed to load module:', error);
            this._loadError = error;
            this._isLoading = false;
            this._isLoaded = false;

            throw new Error(`Failed to load WASM SITL module: ${error.message}`);
        }
    }

    /**
     * Dispose of the WASM module completely
     * This returns the loader to initial state, as if it was just created
     * Safe to call multiple times - will skip if already disposed
     */
    dispose() {
        // If already disposed, skip
        if (!this._module && !this._scriptTag && !this._isLoaded) {
            console.log('[WASM SITL] Already disposed, skipping');
            return;
        }

        console.log('[WASM SITL] Disposing module...');

        // Stop main loop if running
        if (this._module && this._module._stopMainLoop) {
            try {
                this._module._stopMainLoop();
                console.log('[WASM SITL] Main loop stopped');
            } catch (e) {
                console.warn('[WASM SITL] Error stopping main loop:', e);
            }
        }

        // Remove script tag from DOM
        if (this._scriptTag && this._scriptTag.parentNode) {
            try {
                this._scriptTag.parentNode.removeChild(this._scriptTag);
                console.log('[WASM SITL] Script tag removed from DOM');
            } catch (e) {
                console.warn('[WASM SITL] Error removing script tag:', e);
            }
            this._scriptTag = null;
        }

        // Clear global Module object
        if (typeof window.Module !== 'undefined') {
            window.Module = undefined;
            console.log('[WASM SITL] Global Module object cleared');
        }

        // Clear instance state
        this._module = null;
        this._isLoaded = false;
        this._isLoading = false;
        this._loadError = null;

        // Clear callbacks
        this._dataCallback = null;
        this._rebootCallback = null;
        this._reconnectCallback = null;

        // Close IndexedDB connection (but don't delete the data)
        if (this._db) {
            this._db.close();
            this._db = null;
        }

        console.log('[WASM SITL] Module disposed - returned to initial state');
    }

    /**
     * Reload the WASM module (for manual reload, not used by reboot)
     * @returns {Promise<object>} Reloaded Emscripten Module
     */
    async reload() {
        console.log('[WASM SITL] Reloading module...');
        this.dispose();
        return await this.load();
    }

    /**
     * Load the Emscripten glue code which will automatically load the WASM binary
     * @private
     * @param {Uint8Array|null} storedEeprom - Pre-loaded EEPROM data from IndexedDB
     * @returns {Promise<object>} Initialized Module
     */
    async _loadEmscriptenGlue(storedEeprom) {
        return new Promise((resolve, reject) => {
            // Reference to loader instance for callbacks
            const loader = this;

            // Emscripten Module configuration
            const Module = {
                // Delay main() so we can inject stored EEPROM data first
                // After injecting, we manually call callMain()
                noInitialRun: true,

                // Disable filesystem access (not needed for SITL)
                noFSInit: true,

                // Memory is managed by WASM build (-sALLOW_MEMORY_GROWTH=1)
                // Do not set INITIAL_MEMORY here - it conflicts with ALLOW_MEMORY_GROWTH

                // Data ready callback (called by WASM when response data available)
                wasmSerialDataCallback: () => {
                    if (this._dataCallback) {
                        this._dataCallback();
                    }
                },

                // EEPROM saved callback (called by WASM after writeEEPROM completes)
                wasmEepromSavedCallback: () => {
                    console.log('[WASM SITL] EEPROM save notification received');
                    const eepromData = loader._readEepromFromWasm();
                    if (eepromData) {
                        loader._saveEepromToStorage(eepromData);
                    }
                },

                // Reboot callback (called by WASM when systemReset() is triggered)
                // IMPORTANT: Don't try to clean up WASM from inside this callback!
                // We're being called from EM_ASM inside WASM, so any cleanup here causes freezing.
                // Just request the page reload via IPC - the reload will clean everything up.
                wasmRequestReboot: () => {
                    console.log('[WASM SITL] Reboot requested - requesting page reload via IPC');
                    if (window.electronAPI && window.electronAPI.reloadPage) {
                        window.electronAPI.reloadPage();
                    } else {
                        console.error('[WASM SITL] electronAPI.reloadPage not available');
                    }
                },

                // Paths to WASM binary and data files
                locateFile: (path, scriptDirectory) => {
                    // The WASM file will be loaded from resources/sitl/
                    // Build outputs SITL.elf.wasm (emscripten naming convention)
                    if (path.endsWith('.wasm')) {
                        return 'resources/sitl/' + path;
                    }
                    return scriptDirectory + path;
                },

                // Print output to console
                print: (text) => {
                    console.log('[WASM SITL]', text);
                },

                // Print errors to console
                printErr: (text) => {
                    console.error('[WASM SITL ERROR]', text);
                },

                // Called when runtime is initialized (before main() since noInitialRun: true)
                onRuntimeInitialized: () => {
                    console.log('[WASM SITL] Runtime initialized');

                    // Verify that the serial interface functions are exported
                    if (typeof Module._serialWriteByte !== 'function' ||
                        typeof Module._serialReadByte !== 'function' ||
                        typeof Module._serialAvailable !== 'function') {
                        reject(new Error('Serial interface functions not found. The WASM module may not be built correctly.'));
                        return;
                    }

                    // Verify EEPROM bridge functions are exported
                    const hasEepromBridge = typeof Module._wasmGetEepromPtr === 'function' &&
                        typeof Module._wasmGetEepromSize === 'function';

                    if (!hasEepromBridge) {
                        console.warn('[WASM SITL] EEPROM bridge functions not found - persistence disabled');
                    } else if (storedEeprom) {
                        // Inject stored EEPROM data BEFORE calling main()
                        // This way, init() will read our stored data instead of using defaults
                        const ptr = Module._wasmGetEepromPtr();
                        const size = Module._wasmGetEepromSize();

                        if (ptr && size && storedEeprom.length === size) {
                            console.log('[WASM SITL] Injecting stored EEPROM data before main()...');
                            Module.HEAPU8.set(storedEeprom, ptr);
                            console.log('[WASM SITL] Injected', storedEeprom.length, 'bytes to EEPROM buffer');
                        } else {
                            console.warn('[WASM SITL] EEPROM size mismatch or invalid pointer, using defaults');
                        }
                    }

                    // Now call main() - the firmware will read our injected EEPROM data
                    console.log('[WASM SITL] Starting firmware (calling main)...');
                    Module.callMain();

                    console.log('[WASM SITL] Firmware initialized and scheduler running');

                    resolve(Module);
                },

                // Called when runtime fails to initialize
                onAbort: (error) => {
                    reject(new Error(`WASM runtime aborted: ${error}`));
                }
            };

            // Load the Emscripten-generated JavaScript file
            // This will automatically load the WASM binary via the locateFile callback
            const script = document.createElement('script');
            script.src = 'resources/sitl/SITL.elf'; // .elf is the Emscripten .js glue code
            script.async = true;

            script.onerror = () => {
                reject(new Error('Failed to load SITL JavaScript glue code (SITL.elf). Make sure the WASM binaries are built and copied to resources/sitl/'));
            };

            // The Module object needs to be global for Emscripten to find it
            window.Module = Module;

            // Save script tag reference so we can remove it on reload (Scavanger's approach)
            this._scriptTag = script;

            document.head.appendChild(script);
        });
    }

    /**
     * Get the loaded WASM module
     * @returns {object|null} The Emscripten Module object, or null if not loaded
     */
    getModule() {
        return this._module;
    }

    /**
     * Check if the module is currently loaded
     * @returns {boolean} true if loaded and ready to use
     */
    isLoaded() {
        return this._isLoaded;
    }

    /**
     * Check if the module is currently loading
     * @returns {boolean} true if load() is in progress
     */
    isLoading() {
        return this._isLoading;
    }

    /**
     * Get the last loading error, if any
     * @returns {Error|null} The error that occurred during loading, or null
     */
    getError() {
        return this._loadError;
    }

    /**
     * Set callback for when WASM has data ready (like a hardware interrupt)
     * This is called by WASM when it completes writing a response
     * @param {function} callback - Function to call when data is available
     */
    setDataCallback(callback) {
        this._dataCallback = callback;
    }

    /**
     * Called by firmware when systemReset() is triggered, before module reloads
     * @param {function} callback - Typically used to trigger GUI disconnect
     */
    setRebootCallback(callback) {
        this._rebootCallback = callback;
    }

    /**
     * Called after WASM module successfully reloads
     * @param {function} callback - Typically used to trigger GUI reconnect
     */
    setReconnectCallback(callback) {
        this._reconnectCallback = callback;
    }

    /**
     * Clear all stored EEPROM data from IndexedDB
     * Use this for "reset to factory defaults" functionality
     * @returns {Promise<void>}
     */
    async clearStoredSettings() {
        try {
            const db = await this._openDatabase();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(EEPROM_STORE_NAME, 'readwrite');
                const store = transaction.objectStore(EEPROM_STORE_NAME);
                const request = store.delete(EEPROM_KEY);

                request.onerror = () => {
                    console.error('[WASM SITL] Failed to clear stored settings:', request.error);
                    reject(request.error);
                };

                request.onsuccess = () => {
                    console.log('[WASM SITL] Stored settings cleared');
                    resolve();
                };
            });
        } catch (error) {
            console.error('[WASM SITL] Error clearing stored settings:', error);
        }
    }

    /**
     * Check if there are stored settings in IndexedDB
     * @returns {Promise<boolean>}
     */
    async hasStoredSettings() {
        const data = await this._loadStoredEeprom();
        return data !== null;
    }
}

export { WasmSitlLoader };
