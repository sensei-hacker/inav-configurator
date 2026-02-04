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
 * - Exports MSP interface for direct function calls from JavaScript
 * - Handles errors gracefully with user-friendly messages
 *
 * Usage Example:
 * ```javascript
 * import { WasmSitlLoader } from './wasm_sitl_loader.js';
 *
 * // Check browser compatibility
 * if (!WasmSitlLoader.isWasmSupported()) {
 *     alert('Your browser does not support WebAssembly');
 *     return;
 * }
 *
 * // Create loader
 * const loader = new WasmSitlLoader();
 *
 * // Load the module
 * try {
 *     const module = await loader.load();
 *     console.log('SITL loaded successfully');
 *
 *     // Send MSP command (example: MSP_API_VERSION = 1)
 *     const reply = loader.processMspCommand(1, null);
 *     console.log('API Version:', reply[1] + '.' + reply[2]);
 * } catch (error) {
 *     console.error('Failed to load SITL:', error);
 * }
 * ```
 */

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
    }

    /**
     * Check if WASM is supported in this browser
     * @returns {boolean} true if WebAssembly is available
     */
    static isWasmSupported() {
        return typeof WebAssembly === 'object'
            && typeof WebAssembly.instantiate === 'function';
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

            // Load the Emscripten glue code (SITL.elf is actually a .js file)
            const module = await this._loadEmscriptenGlue();

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
     * @returns {Promise<object>} Initialized Module
     */
    async _loadEmscriptenGlue() {
        return new Promise((resolve, reject) => {
            // Emscripten Module configuration
            const Module = {
                // Let Emscripten call main() automatically after runtime init
                // main() will call init() and start the scheduler loop
                noInitialRun: false,

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
                    if (path.endsWith('.wasm')) {
                        return 'resources/sitl/SITL.wasm';
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

                // Called when runtime is initialized
                onRuntimeInitialized: () => {
                    console.log('[WASM SITL] Runtime initialized');

                    // Verify that the MSP bridge function is exported
                    if (typeof Module._wasm_msp_process_command !== 'function') {
                        reject(new Error('MSP bridge function not found. The WASM module may not be built correctly.'));
                        return;
                    }

                    // main() has been called automatically (noInitialRun: false)
                    // It calls init() and starts the scheduler loop via emscripten_set_main_loop()
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
     * Process an MSP command through the WASM SITL
     * This is a convenience wrapper around the Module._wasm_msp_process_command function
     *
     * @param {number} cmdId - MSP command ID (e.g., 1 = MSP_API_VERSION, 101 = MSP_STATUS)
     * @param {Uint8Array} cmdData - Command payload data (can be empty/null for commands with no payload)
     * @returns {Uint8Array} MSP response data
     * @throws {Error} If module is not loaded or command processing fails
     */
    processMspCommand(cmdId, cmdData = null) {
        if (!this._isLoaded || !this._module) {
            throw new Error('WASM module is not loaded');
        }

        const Module = this._module;

        const cmdLen = cmdData ? cmdData.length : 0;
        const replyMaxSize = 1024; // Max MSP reply size

        let cmdPtr = 0;
        const replyPtr = Module._malloc(replyMaxSize);

        try {
            // Allocate and copy command data if present
            if (cmdData && cmdLen > 0) {
                cmdPtr = Module._malloc(cmdLen);
                Module.HEAPU8.set(cmdData, cmdPtr);
            }

            // Call the WASM MSP processor
            // int wasm_msp_process_command(uint16_t cmdId, uint8_t *cmdData, int cmdLen,
            //                               uint8_t *replyData, int replyMaxLen)
            // Returns: >= 0 = reply length, -1 = error, -2 = buffer too small, -3 = invalid params
            const replyLength = Module._wasm_msp_process_command(
                cmdId,
                cmdPtr,
                cmdLen,
                replyPtr,
                replyMaxSize
            );

            if (replyLength < 0) {
                const errorMsg = replyLength === -1 ? 'MSP_RESULT_ERROR'
                    : replyLength === -2 ? 'Reply buffer too small'
                    : replyLength === -3 ? 'Invalid parameters'
                    : `Unknown error code: ${replyLength}`;
                throw new Error(`MSP command ${cmdId} failed: ${errorMsg}`);
            }

            // Copy reply data from WASM memory using getValue
            const reply = new Uint8Array(replyLength);
            for (let i = 0; i < replyLength; i++) {
                reply[i] = Module.getValue(replyPtr + i, 'i8') & 0xFF;
            }

            return reply;

        } finally {
            // Always free the allocated memory
            if (cmdPtr) {
                Module._free(cmdPtr);
            }
            Module._free(replyPtr);
        }
    }
}

export { WasmSitlLoader };
