/**
 * Monaco Editor Loader for INAV Configurator
 * 
 * Handles loading Monaco Editor in Electron environment with proper AMD loader support.
 * This module is separate to keep the main javascript_programming.js cleaner.
 * 
 * Location: js/transpiler/editor/monaco_loader.js
 */

'use strict';

import path from 'node:path';

/**
 * Load Monaco Editor
 * @returns {Promise<Object>} Promise that resolves with monaco object
 */
function loadMonacoEditor() {
    return new Promise((resolve, reject) => {
        try {
            // Check if already loaded
            if (window.monaco) {
                resolve(window.monaco);
                return;
            }
            
            // Find monaco-editor path
            let monacoBasePath;
            try {
                monacoBasePath = path.dirname(require.resolve('monaco-editor/package.json'));
            } catch (e) {
                monacoBasePath = path.join(__dirname, '../../node_modules/monaco-editor');
            }
            
            // Use the min build which includes everything
            const vsPath = path.join(monacoBasePath, 'min/vs');
            const editorMainPath = path.join(vsPath, 'editor/editor.main.js');
            
            console.log('Loading Monaco from:', vsPath);
            
            // Method 1: Try loading editor.main.js directly
            const editorScript = document.createElement('script');
            editorScript.src = 'file://' + editorMainPath.replace(/\\/g, '/');
            
            editorScript.onerror = () => {
                // Method 2: If direct load fails, try AMD loader
                console.log('Direct load failed, trying AMD loader...');
                loadMonacoViaAMD(vsPath, resolve, reject);
            };
            
            editorScript.onload = () => {
                if (window.monaco) {
                    console.log('Monaco loaded via direct script');
                    resolve(window.monaco);
                } else {
                    loadMonacoViaAMD(vsPath, resolve, reject);
                }
            };
            
            document.head.appendChild(editorScript);
            
        } catch (error) {
            console.error('Failed to load Monaco Editor:', error);
            reject(error);
        }
    });
}

/**
 * Load Monaco via AMD loader (fallback method)
 * @param {string} vsPath - Path to Monaco's vs directory
 * @param {Function} resolve - Promise resolve function
 * @param {Function} reject - Promise reject function
 */
function loadMonacoViaAMD(vsPath, resolve, reject) {
    // Set global MonacoEnvironment before loading
    window.MonacoEnvironment = {
        getWorkerUrl: function(workerId, label) {
            return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
                self.MonacoEnvironment = {
                    baseUrl: 'file://${vsPath.replace(/\\/g, '/')}'
                };
                importScripts('file://${vsPath.replace(/\\/g, '/')}/base/worker/workerMain.js');
            `)}`;
        }
    };
    
    const loaderScript = document.createElement('script');
    loaderScript.src = 'file://' + vsPath.replace(/\\/g, '/') + '/loader.js';
    
    loaderScript.onerror = () => {
        reject(new Error('Failed to load Monaco loader.js'));
    };
    
    loaderScript.onload = () => {
        try {
            // Configure the loader
            window.require.config({
                paths: {
                    'vs': 'file://' + vsPath.replace(/\\/g, '/')
                },
                'vs/nls': {
                    availableLanguages: {}
                }
            });
            
            // Load the editor
            window.require(['vs/editor/editor.main'], function() {
                // Monaco is now available as a global
                const monaco = window.monaco;
                
                if (!monaco || !monaco.editor) {
                    console.error('Monaco object not properly initialized');
                    reject(new Error('Monaco editor object not found'));
                    return;
                }
                
                console.log('Monaco loaded via AMD');
                resolve(monaco);
            }, function(err) {
                console.error('AMD require error:', err);
                reject(err);
            });
        } catch (err) {
            reject(err);
        }
    };
    
    document.head.appendChild(loaderScript);
}

/**
 * Initialize Monaco Editor with INAV-specific configuration
 * @param {Object} monaco - Monaco editor instance
 * @param {string} containerId - ID of the container element
 * @param {Object} options - Additional editor options
 * @returns {Object} Created editor instance
 */
function initializeMonacoEditor(monaco, containerId, options = {}) {
    const editorContainer = document.getElementById(containerId);
    if (!editorContainer) {
        throw new Error(`Monaco editor container '${containerId}' not found`);
    }
    
    // Default configuration
    const defaultOptions = {
        value: '// INAV JavaScript Programming\n// Write JavaScript, get INAV logic conditions!\n\nconst { flight, override, rc, gvar, on } = inav;\n\n// Example:\n// if (flight.homeDistance > 100) {\n//   override.vtx.power = 3;\n// }\n',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        tabSize: 2,
        insertSpaces: true
    };
    
    // Merge options
    const editorOptions = Object.assign({}, defaultOptions, options);
    
    // Create editor
    const editor = monaco.editor.create(editorContainer, editorOptions);
    
    // Set up TypeScript/JavaScript defaults for IntelliSense
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
    });
    
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.CommonJS,
        noEmit: true,
        esModuleInterop: true,
        allowJs: true,
        checkJs: false
    });
    
    console.log('Monaco Editor initialized');
    
    return editor;
}

/**
 * Add INAV API type definitions to Monaco
 * @param {Object} monaco - Monaco editor instance
 */
function addINAVTypeDefinitions(monaco) {
    try {
        const apiDefinitions = require('./../api/definitions/index.js');
        const { generateTypeDefinitions } = require('./../api/types.js');
        const typeDefinitions = generateTypeDefinitions(apiDefinitions);
        
        monaco.languages.typescript.javascriptDefaults.addExtraLib(
            typeDefinitions,
            'ts:inav.d.ts'
        );
        
        console.log('INAV API type definitions loaded');
        return true;
    } catch (error) {
        console.error('Failed to load INAV type definitions:', error);
        return false;
    }
}

/**
 * Set up real-time linting with debounce
 * @param {Object} editor - Monaco editor instance
 * @param {Function} lintCallback - Function to call for linting
 * @param {number} debounceMs - Debounce delay in milliseconds
 */
function setupLinting(editor, lintCallback, debounceMs = 500) {
    let lintTimeout;
    
    editor.onDidChangeModelContent(() => {
        clearTimeout(lintTimeout);
        lintTimeout = setTimeout(() => {
            if (typeof lintCallback === 'function') {
                lintCallback();
            }
        }, debounceMs);
    });
}

// Export functions
export {
    loadMonacoEditor,
    initializeMonacoEditor,
    addINAVTypeDefinitions,
    setupLinting
};
