'use strict';

import { GUI } from './../gui';
import { ConnectionType, Connection } from './connection';
import i18n from './../localization';
import { WasmSitlLoader } from './../wasm_sitl_loader';

/**
 * WASM Connection Backend
 *
 * Provides a connection interface to the INAV SITL (Software In The Loop) simulator
 * running as WebAssembly in the browser. This allows testing and configuration of
 * flight controller firmware without physical hardware.
 *
 * Uses byte-level serial interface:
 * - Passes raw MSP packet bytes to WASM via serialWriteByte()
 * - WASM uses firmware's existing MSP parser (same as UART/BLE)
 * - Reads response bytes via serialReadByte()
 * - Consistent with other connections, reuses firmware code
 */
class ConnectionWasm extends Connection {
    constructor() {
        super();

        this._loader = null;
        this._onReceiveListeners = [];
        this._onReceiveErrorListeners = [];
        super._type = ConnectionType.WASM;

        // Track reboot event handler to prevent memory leak on reconnect
        this._wasmRebootHandler = null;
    }

    /**
     * Connect to the WASM SITL simulator
     * @param {string} path - Connection path (unused for WASM, can be "SITL" or similar)
     * @param {object} options - Connection options
     * @param {function} callback - Called with connection info or false on failure
     */
    connectImplementation(path, options, callback) {
        console.log('[WASM Connection] Connecting to SITL simulator...');

        // Prevent connection during module reload
        if (this._loader && this._loader.isLoading()) {
            console.log('[WASM Connection] Cannot connect: module is reloading');
            if (callback) {
                callback(false);
            }
            return;
        }

        // Check if WASM is supported
        if (!WasmSitlLoader.isWasmSupported()) {
            const errorMsg = i18n.getMessage('connectionWasmNotSupported') ||
                           'WebAssembly is not supported in this browser';
            GUI.log(errorMsg);
            console.error('[WASM Connection] WebAssembly not supported');
            if (callback) {
                callback(false);
            }
            return;
        }

        // Create loader instance if not already created
        if (!this._loader) {
            this._loader = new WasmSitlLoader();
        }

        // Load the WASM module
        this._loader.load()
            .then(() => {
                // WASM module loaded successfully
                const connectionMsg = i18n.getMessage('connectionConnected', ['SITL (WebAssembly)']) ||
                                    'Connected to SITL (WebAssembly)';
                GUI.log(connectionMsg);

                // Generate a pseudo-connection ID (WASM doesn't have real connections)
                this._connectionId = Date.now();

                // Register callback for when WASM has data ready (like a hardware interrupt)
                this._loader.setDataCallback(() => {
                    this._onSerialDataAvailable();
                });

                // Register reboot callback - disconnect when firmware reboots
                // After reboot, the WASM instance is completely disposed and the
                // UI returns to disconnected state (like at startup)
                this._loader.setRebootCallback(() => {
                    console.log('[WASM Connection] Firmware rebooting - dispatching reload event');
                    const event = new CustomEvent('wasm-reboot', {
                        detail: { timestamp: Date.now() }
                    });
                    window.dispatchEvent(event);
                });

                // Remove any existing listener to prevent memory leak on reconnect
                if (this._wasmRebootHandler) {
                    window.removeEventListener('wasm-reboot', this._wasmRebootHandler);
                }

                // Listen for the reboot event and reload the page
                this._wasmRebootHandler = () => {
                    console.log('[WASM Connection] Received wasm-reboot event, requesting reload');
                    if (window.electronAPI && window.electronAPI.reloadPage) {
                        window.electronAPI.reloadPage();
                    } else {
                        console.error('[WASM Connection] electronAPI.reloadPage not available!');
                    }
                };
                window.addEventListener('wasm-reboot', this._wasmRebootHandler, { once: true });

                console.log('[WASM Connection] Connected successfully, ID:', this._connectionId);

                if (callback) {
                    callback({
                        bitrate: 115200, // Simulate a standard baud rate
                        connectionId: this._connectionId
                    });
                }
            })
            .catch(error => {
                const errorMsg = i18n.getMessage('connectionWasmLoadFailed') ||
                               'Failed to load WASM SITL module';
                GUI.log(`${errorMsg}: ${error.message}`);
                console.error('[WASM Connection] Failed to load:', error);

                if (callback) {
                    callback(false);
                }
            });
    }

    /**
     * Disconnect from WASM SITL
     * Disposes of the WASM instance completely, returning to startup state
     * @param {function} callback - Called with true on success
     */
    disconnectImplementation(callback) {
        console.log('[WASM Connection] Disconnecting...');

        // Dispose of WASM instance completely if loaded
        if (this._loader) {
            if (this._loader.isLoaded()) {
                console.log('[WASM Connection] Disposing WASM instance...');
                this._loader.dispose();
                console.log('[WASM Connection] WASM instance disposed - returned to startup state');
            } else {
                console.log('[WASM Connection] WASM instance already disposed or not loaded');
            }
        }

        // Clear connection ID
        this._connectionId = null;

        console.log('[WASM Connection] Disconnect complete');

        if (callback) {
            callback(true);
        }
    }

    /**
     * APPROACH 2: Send raw MSP packet bytes to WASM (current implementation)
     *
     * This behaves like Serial/TCP/BLE connections - just passes bytes through.
     * WASM's MSP parser handles packet framing/parsing.
     *
     * When WASM completes processing and has a response ready, it will call
     * our registered callback (set in connectImplementation), which triggers
     * _onSerialDataAvailable() to read the response.
     *
     * @param {ArrayBuffer} data - MSP packet data (framed)
     * @param {function} callback - Called with send result {bytesSent, resultCode}
     */
    sendImplementation(data, callback) {
        if (!this._connectionId || !this._loader || !this._loader.isLoaded()) {
            console.error('[WASM Connection] Cannot send: not connected');
            if (callback) {
                callback({ bytesSent: 0, resultCode: 1 });
            }
            return;
        }

        try {
            const bytes = new Uint8Array(data);
            const module = this._loader.getModule();

            // Write each byte to WASM serial RX buffer
            for (let i = 0; i < bytes.length; i++) {
                module._serialWriteByte(bytes[i]);
            }

            // No polling needed! WASM will call our callback when data is ready
            // (via Module.wasmSerialDataCallback -> _onSerialDataAvailable)

            // Report successful send
            if (callback) {
                callback({
                    bytesSent: bytes.length,
                    resultCode: 0
                });
            }

        } catch (error) {
            console.error('[WASM Connection] Send error:', error);

            this._onReceiveErrorListeners.forEach(listener => {
                listener(error.message);
            });

            if (callback) {
                callback({ bytesSent: 0, resultCode: 1 });
            }
        }
    }

    /**
     * Called by WASM when serial response data is available (interrupt-style callback)
     * Reads all available bytes and triggers receive listeners
     * @private
     */
    _onSerialDataAvailable() {
        const module = this._loader.getModule();

        // Check if response data available
        const available = module._serialAvailable();
        if (available <= 0) {
            return;  // No data (shouldn't happen, but be safe)
        }

        // Read all available bytes from WASM TX buffer
        const responseBytes = new Uint8Array(available);
        for (let i = 0; i < available; i++) {
            const byte = module._serialReadByte();
            if (byte >= 0) {
                responseBytes[i] = byte;
            }
        }

        // Trigger receive callbacks (notify configurator that data arrived)
        this._onReceiveListeners.forEach(listener => {
            listener({
                connectionId: this._connectionId,
                data: responseBytes.buffer
            });
        });
    }

    /**
     * Add a callback for received data
     */
    addOnReceiveCallback(callback) {
        this._onReceiveListeners.push(callback);
    }

    /**
     * Remove a receive callback
     */
    removeOnReceiveCallback(callback) {
        this._onReceiveListeners = this._onReceiveListeners.filter(
            listener => listener !== callback
        );
    }

    /**
     * Add a callback for receive errors
     */
    addOnReceiveErrorCallback(callback) {
        this._onReceiveErrorListeners.push(callback);
    }

    /**
     * Remove an error callback
     */
    removeOnReceiveErrorCallback(callback) {
        this._onReceiveErrorListeners = this._onReceiveErrorListeners.filter(
            listener => listener !== callback
        );
    }
}

export default ConnectionWasm;
