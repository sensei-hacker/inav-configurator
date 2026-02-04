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
 * ARCHITECTURE NOTES:
 * ===================
 * This connection backend has TWO possible implementation approaches:
 *
 * APPROACH 1: Direct MSP Command Interface (COMMENTED OUT)
 * ----------------------------------------------------------
 * - Parses outgoing MSP packets to extract command ID and payload
 * - Calls wasm_msp_process_command(cmdId, cmdData, cmdLen, replyData, replyMaxLen) directly
 * - Builds MSP response packets from WASM replies
 * - Pro: Fast, synchronous, minimal overhead
 * - Con: Bypasses firmware's MSP serial parser, less realistic simulation
 * - Status: Fully implemented and tested, preserved below as fallback
 *
 * APPROACH 2: Byte-Level Serial Interface (CURRENT)
 * ---------------------------------------------------
 * - Passes raw MSP packet bytes to WASM via serialWrite()
 * - WASM uses firmware's existing MSP parser (same as UART/BLE)
 * - Reads response bytes via serialRead()
 * - Pro: Consistent with other connections, reuses firmware code, more realistic
 * - Con: Requires additional WASM exports
 * - Status: Active implementation
 *
 * To switch back to Approach 1:
 * 1. Comment out the Approach 2 implementation
 * 2. Uncomment the Approach 1 implementation sections marked below
 * 3. No other changes needed
 */
class ConnectionWasm extends Connection {
    constructor() {
        super();

        this._loader = null;
        this._onReceiveListeners = [];
        this._onReceiveErrorListeners = [];
        super._type = ConnectionType.WASM;

        // MSP protocol constants (used by Approach 1 if we switch back)
        this.MSP_SYMBOLS = {
            BEGIN: 0x24,        // '$'
            PROTO_V2: 0x58,     // 'X'
            TO_MWC: 0x3C,       // '<'
            FROM_MWC: 0x3E,     // '>'
        };

        // Approach 2: Buffer for accumulating response bytes from WASM
        this._receiveBuffer = new Uint8Array(4096);
        this._receiveBufferPos = 0;

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

        // Clear receive buffer
        this._receiveBufferPos = 0;

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

    /* ============================================================================
     * APPROACH 1: Direct MSP Command Interface (PRESERVED AS FALLBACK)
     * ============================================================================
     *
     * This approach was fully implemented and tested. It parses MSP packets in
     * JavaScript and calls wasm_msp_process_command() directly.
     *
     * To re-enable:
     * 1. Comment out the current sendImplementation() above
     * 2. Uncomment the implementation below
     * 3. Uncomment the helper methods (_buildMspV2Response, _crc8_dvb_s2)
     *
     * wasm_msp_process_command() signature:
     * int wasm_msp_process_command(
     *     uint16_t cmdId,      // MSP command ID
     *     uint8_t *cmdData,    // Command payload (or 0 for no data)
     *     int cmdLen,          // Payload length
     *     uint8_t *replyData,  // Reply buffer
     *     int replyMaxLen      // Reply buffer size
     * )
     * Returns: >= 0 = reply length, -1 = error, -2 = buffer too small, -3 = invalid params
     */

    /*
    sendImplementation(data, callback) {
        if (!this._connectionId || !this._loader || !this._loader.isLoaded()) {
            console.error('[WASM Connection] Cannot send: not connected');
            if (callback) {
                callback({ bytesSent: 0, resultCode: 1 });
            }
            return;
        }

        try {
            const packet = new Uint8Array(data);

            // Parse MSP V2 packet format:
            // [0] = '$', [1] = 'X', [2] = '<', [3] = flag,
            // [4-5] = code (LE), [6-7] = length (LE), [8...] = payload, [last] = checksum

            // Validate packet header
            if (packet.length < 9 ||
                packet[0] !== this.MSP_SYMBOLS.BEGIN ||
                packet[1] !== this.MSP_SYMBOLS.PROTO_V2 ||
                packet[2] !== this.MSP_SYMBOLS.TO_MWC) {
                console.error('[WASM Connection] Invalid MSP packet format');
                if (callback) {
                    callback({ bytesSent: 0, resultCode: 1 });
                }
                return;
            }

            // Extract command code (little-endian uint16)
            const cmdCode = packet[4] | (packet[5] << 8);

            // Extract payload length (little-endian uint16)
            const payloadLength = packet[6] | (packet[7] << 8);

            // Extract payload (if any)
            const cmdPayload = payloadLength > 0
                ? packet.slice(8, 8 + payloadLength)
                : null;

            // Call WASM MSP processor
            const reply = this._loader.processMspCommand(cmdCode, cmdPayload);

            // Build MSP V2 response packet
            const response = this._buildMspV2Response(cmdCode, reply);

            // Asynchronously trigger receive callbacks (simulate network/serial delay)
            setTimeout(() => {
                this._onReceiveListeners.forEach(listener => {
                    listener({
                        connectionId: this._connectionId,
                        data: response.buffer
                    });
                });
            }, 0);

            // Report successful send
            if (callback) {
                callback({
                    bytesSent: packet.length,
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
    */

    /**
     * APPROACH 1 HELPER: Build an MSP V2 response packet
     * @private
     */
    /*
    _buildMspV2Response(cmdCode, payload) {
        const payloadLength = payload ? payload.length : 0;
        const packetLength = 9 + payloadLength; // header(8) + payload + checksum(1)

        const packet = new Uint8Array(packetLength);

        // Build MSP V2 response header
        packet[0] = this.MSP_SYMBOLS.BEGIN;      // '$'
        packet[1] = this.MSP_SYMBOLS.PROTO_V2;   // 'X'
        packet[2] = this.MSP_SYMBOLS.FROM_MWC;   // '>' (response direction)
        packet[3] = 0;                            // flag (reserved)
        packet[4] = cmdCode & 0xFF;              // code low byte
        packet[5] = (cmdCode >> 8) & 0xFF;       // code high byte
        packet[6] = payloadLength & 0xFF;        // length low byte
        packet[7] = (payloadLength >> 8) & 0xFF; // length high byte

        // Copy payload if present
        if (payload && payloadLength > 0) {
            packet.set(payload, 8);
        }

        // Calculate CRC8-DVB-S2 checksum (same algorithm as msp.js)
        let checksum = 0;
        for (let i = 3; i < packetLength - 1; i++) {
            checksum = this._crc8_dvb_s2(checksum, packet[i]);
        }
        packet[packetLength - 1] = checksum;

        return packet;
    }
    */

    /**
     * APPROACH 1 HELPER: CRC8-DVB-S2 checksum calculation (matches msp.js)
     * @private
     */
    /*
    _crc8_dvb_s2(crc, ch) {
        crc ^= ch;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x80) {
                crc = ((crc << 1) & 0xFF) ^ 0xD5;
            } else {
                crc = (crc << 1) & 0xFF;
            }
        }
        return crc;
    }
    */

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
