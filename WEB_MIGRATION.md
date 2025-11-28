# INAV Configurator: Electron to Web App Migration Guide

## Overview

This document outlines the high-level checklist and key files that would need to be modified to convert the INAV Configurator from an Electron desktop application to a web application.

---

## High-Level Migration Checklist

### 1. Serial Communication Layer
- [ ] Replace Node.js `serialport` with Web Serial API (`navigator.serial`)
- [ ] Implement browser permission handling for serial port access
- [ ] Add fallback for browsers that don't support Web Serial API
- [ ] Handle serial port enumeration differently (user must manually select ports)

### 2. Storage/Persistence
- [ ] Replace `electron-store` with Web Storage APIs (localStorage/IndexedDB)
- [ ] Migrate stored settings format if needed
- [ ] Handle storage quota limitations in browsers

### 3. File System Access
- [ ] Replace Node.js `fs` operations with File System Access API or File/Blob APIs
- [ ] Use `<input type="file">` for file uploads (hex files, configurations)
- [ ] Use download links or File System Access API for file saves
- [ ] Handle firmware file loading from browser

### 4. IPC/Main Process Communication
- [ ] Remove all Electron IPC (`ipcMain`, `ipcRenderer`) communications
- [ ] Replace `window.electronAPI` bridge with direct browser API calls
- [ ] Create web-compatible abstraction layer for platform features

### 5. TCP/UDP Networking
- [ ] Replace Node.js `net` and `dgram` modules with WebSocket connections
- [ ] Consider proxy server for TCP/UDP → WebSocket bridging (for SITL support)
- [ ] Evaluate if TCP/UDP features can be omitted in web version

### 6. USB/DFU Access
- [ ] Replace Node.js `usb` module with WebUSB API (`navigator.usb`)
- [ ] Implement browser permission flows for USB device access
- [ ] Handle DFU firmware flashing via WebUSB

### 7. Child Process/SITL
- [ ] SITL (Software In The Loop) won't work in browser - requires native executable
- [ ] Consider WebAssembly port of SITL or remove feature from web version
- [ ] Or provide alternative remote SITL connection via WebSocket

### 8. Bluetooth BLE
- [ ] Already uses Web Bluetooth API (`navigator.bluetooth`) - mostly compatible
- [ ] Verify browser compatibility and handle unsupported browsers

### 9. Dialog/Window Management
- [ ] Replace Electron dialog APIs with browser-native dialogs
- [ ] Replace `dialog.showOpenDialog` with `<input type="file">`
- [ ] Replace `dialog.showSaveDialog` with download triggers or File System Access API
- [ ] Replace `alert`/`confirm` calls (already using custom implementation)

### 10. Build System
- [ ] Create new Vite configuration for web build (no Electron)
- [ ] Remove Electron-specific plugins and configurations
- [ ] Set up static hosting deployment (e.g., GitHub Pages, Netlify)

### 11. External Link Handling
- [ ] Remove `shell.openExternal` usage
- [ ] Use standard `target="_blank"` links

### 12. App Updates
- [ ] Remove or redesign app update notification system
- [ ] Consider PWA (Progressive Web App) approach with service workers

### 13. Platform Detection
- [ ] Update `GUI.operating_system` detection for browser environments
- [ ] Remove platform-specific code paths that don't apply to web

---

## Key Files That Need Changes

### Core Electron Files (Remove/Replace)
| File | Description | Required Action |
|------|-------------|--------|
| `js/main/main.js` | Electron main process | Remove entirely |
| `js/main/preload.js` | Electron preload script | Remove entirely |
| `js/main/serial.js` | Node.js serial port handling | Remove (replace with Web Serial) |
| `js/main/tcp.js` | Node.js TCP socket handling | Remove or replace with WebSocket |
| `js/main/udp.js` | Node.js UDP socket handling | Remove or replace with WebSocket |
| `js/main/child_process.js` | Node.js child process for SITL | Remove (SITL not supported in web) |
| `forge.config.js` | Electron Forge configuration | Remove entirely |

### Configuration Files (Modify)
| File | Description | Changes Needed |
|------|-------------|----------------|
| `package.json` | Project dependencies | Remove Electron deps, add web build scripts |
| `vite.base.config.js` | Base Vite config | Modify for web-only build |
| `vite.main.config.js` | Main process Vite config | Remove |
| `vite.preload.config.js` | Preload Vite config | Remove |
| `vite.main-renderer.config.js` | Renderer Vite config | Modify for web deployment |

### Connection Layer (Major Refactor)
| File | Description | Changes Needed |
|------|-------------|----------------|
| `js/connection/connectionSerial.js` | Serial connection via IPC | Rewrite to use Web Serial API |
| `js/connection/connectionTcp.js` | TCP connection via IPC | Rewrite to use WebSocket |
| `js/connection/connectionUdp.js` | UDP connection via IPC | Rewrite to use WebSocket |
| `js/connection/connectionBle.js` | BLE connection | Minor changes (mostly compatible) |
| `js/connection/connectionFactory.js` | Connection factory | Update to use web implementations |
| `js/connection/connection.js` | Base connection class | Review for compatibility |

### Storage & Platform Abstraction (Refactor)
| File | Description | Changes Needed |
|------|-------------|----------------|
| `js/store.js` | Electron store wrapper | Rewrite to use localStorage/IndexedDB |
| `js/dialog.js` | Electron dialog wrapper | Rewrite to use File APIs/browser dialogs |
| `js/sitl.js` | SITL process management | Remove or stub (not supported in web) |

### UI & Application Logic (Minor Updates)
| File | Description | Changes Needed |
|------|-------------|----------------|
| `js/configurator_main.js` | Main app initialization | Remove Electron-specific code |
| `js/gui.js` | GUI utilities | Update platform detection |
| `js/port_handler.js` | Serial port handler | Update to use Web Serial API |
| `js/appUpdater.js` | App update checker | Simplify for web version |
| `index.html` | Main HTML file | May need minor updates |

### Tab-Specific Files (Review Required)
| File | Description | Changes Needed |
|------|-------------|----------------|
| `tabs/firmware_flasher.js` | Firmware flashing tab | Update file dialogs, verify DFU support |
| `tabs/sitl.js` | SITL tab | Remove or disable |
| `tabs/onboard_logging.js` | Logging download | Update file save mechanism |
| `tabs/cli.js` | CLI tab | Review for compatibility |

---

## Browser API Requirements

The web version will require browsers that support:

1. **Web Serial API** - For flight controller communication
   - Chrome 89+, Edge 89+, Opera 75+
   - Not supported in Firefox, Safari

2. **WebUSB API** - For DFU firmware flashing
   - Chrome 61+, Edge 79+, Opera 48+
   - Not supported in Firefox, Safari

3. **Web Bluetooth API** - For BLE connections
   - Chrome 56+, Edge 79+, Opera 43+
   - Not supported in Firefox (behind flag), Safari

4. **File System Access API** - For file save dialogs (optional, fallback available)
   - Chrome 86+, Edge 86+, Opera 72+

---

## Architecture Recommendations

### Option A: Direct Web App (Recommended for initial version)
- Replace all Electron APIs with browser equivalents
- Limit features to what browsers support natively
- SITL not supported
- Simpler deployment (static files)

### Option B: Hybrid with Backend Server
- Add a small backend server for features browsers can't do
- Enables TCP/UDP proxy via WebSocket
- Could enable SITL via server-side execution
- More complex deployment

### Option C: Progressive Web App (PWA)
- Implement as PWA for installable experience
- Add service workers for offline capability
- Same limitations as Option A
- Better user experience

---

## Shared Code: What Works for Both Electron AND Web

Several changes can be implemented in a way that works for **both** Electron and web apps using the same codebase. This enables a hybrid approach where a single codebase can target both platforms.

### ✅ Fully Compatible (Same Code for Both)

| Category | Approach | Notes |
|----------|----------|-------|
| **BLE/Bluetooth** | Web Bluetooth API | Already uses `navigator.bluetooth` which works in both Electron and browsers |
| **USB/DFU** | WebUSB API | `navigator.usb` works in both Electron (Chromium-based) and browsers |
| **Storage** | localStorage/IndexedDB | These Web APIs work identically in Electron and browsers |
| **Dialogs (alerts/confirms)** | Custom HTML dialogs | The app already uses `jbox`/`smalltalk` for dialogs - works everywhere |
| **External Links** | `target="_blank"` | Standard HTML links work in both environments |
| **UI/Rendering** | All HTML/CSS/JS | The entire UI layer is already web-based and fully compatible |

### 🔄 Compatible with Abstraction Layer

These can share code if you create a thin abstraction layer that detects the environment and uses the appropriate implementation:

| Category | Electron Implementation | Web Implementation | Shared Interface |
|----------|------------------------|-------------------|------------------|
| **Serial Communication** | Node.js `serialport` via IPC | Web Serial API (`navigator.serial`) | Abstract `SerialConnection` class |
| **File Open** | `dialog.showOpenDialog` | `<input type="file">` or File System Access API | `openFile()` function |
| **File Save** | `dialog.showSaveDialog` + `fs.writeFile` | Download link or File System Access API | `saveFile(data, filename)` function |
| **Settings Storage** | `electron-store` (can switch to localStorage) | localStorage/IndexedDB | `store.get()`/`store.set()` interface (already exists!) |

### ❌ Electron-Only Features (Cannot Share Code)

| Feature | Reason | Web Alternative |
|---------|--------|-----------------|
| **SITL** | Requires spawning native executables | Remote SITL via WebSocket proxy, or omit feature |
| **TCP/UDP Sockets** | Node.js `net`/`dgram` modules | WebSocket proxy server required |
| **Native Menus** | Electron-specific APIs | Browser has no equivalent (use in-app menus) |
| **System Tray** | Electron-specific APIs | Not applicable to web |
| **Auto-Updates** | Electron auto-updater | PWA update mechanism or manual |

### Recommended Hybrid Architecture

To maximize code sharing, implement a **platform abstraction layer**:

```
┌─────────────────────────────────────────────────────────┐
│                    Application Code                      │
│         (tabs, UI, MSP protocol, settings, etc.)        │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Platform Abstraction                    │
│    store.js, dialog.js, connection classes, etc.        │
└─────────────────────────────────────────────────────────┘
                     │              │
          ┌──────────┘              └──────────┐
          ▼                                    ▼
┌─────────────────────┐              ┌─────────────────────┐
│   Electron Backend  │              │    Web Backend      │
│  - IPC handlers     │              │  - Web Serial API   │
│  - Node.js serial   │              │  - WebUSB           │
│  - Native dialogs   │              │  - File APIs        │
│  - SITL support     │              │  - localStorage     │
└─────────────────────┘              └─────────────────────┘
```

### Quick Wins for Shared Codebase

1. **`js/store.js`** - Already has the right interface! Just add localStorage fallback:
   ```javascript
   const isElectron = typeof window.electronAPI !== 'undefined';
   const store = {
       get: (key, defaultValue) => isElectron 
           ? window.electronAPI.storeGet(key, defaultValue)
           : JSON.parse(localStorage.getItem(key)) ?? defaultValue,
       set: (key, value) => isElectron
           ? window.electronAPI.storeSet(key, value)
           : localStorage.setItem(key, JSON.stringify(value)),
   };
   ```

2. **`js/connection/connectionBle.js`** - Already uses Web Bluetooth API, works as-is in both!

3. **`js/connection/connectionSerial.js`** - Can detect environment and use Web Serial API in browser:
   ```javascript
   const isElectron = typeof window.electronAPI !== 'undefined';
   // Use electronAPI.serialConnect() in Electron
   // Use navigator.serial in browser
   ```

---

## Estimated Effort by Category

| Category | Effort | Complexity |
|----------|--------|------------|
| Serial Communication | High | High |
| Storage | Low | Low |
| File System | Medium | Medium |
| IPC Removal | Medium | Medium |
| TCP/UDP | High | High |
| USB/DFU | Medium | High |
| SITL | High (if supported) | Very High |
| BLE | Low | Low |
| Dialogs | Low | Low |
| Build System | Medium | Medium |

---

## Browser Compatibility Matrix

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| Web Serial API | ✅ | ✅ | ❌ | ❌ |
| WebUSB | ✅ | ✅ | ❌ | ❌ |
| Web Bluetooth | ✅ | ✅ | 🟡* | ❌ |
| File System Access | ✅ | ✅ | ❌ | ❌ |
| WebSocket | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |

*Firefox has experimental Web Bluetooth support behind a flag (requires `dom.bluetooth.enabled` to be set to `true` in `about:config`)

**Note:** Due to the limited browser support for Web Serial API and WebUSB, the web version would primarily target Chromium-based browsers (Chrome, Edge, Opera, Brave).
