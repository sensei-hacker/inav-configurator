#!/usr/bin/env node

/**
 * UI Test: Power Limiting section in Configuration tab
 *
 * Tests that the Power Limiting section added by PR #2482 is present in
 * tabs/configuration.html with the correct structure, attributes, and bindings.
 *
 * Usage:
 *   node tests/power_limits_ui_test.mjs
 *
 * Expected results:
 *   - On maintenance-9.x (before PR): ALL tests FAIL (section not present)
 *   - On feature-power-limiting-ui (after PR): ALL tests PASS
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve path to configuration.html relative to project root (one level up from tests/)
const configHtmlPath = resolve(__dirname, '..', 'tabs', 'configuration.html');

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, testName, detail = '') {
    if (condition) {
        passCount++;
        console.log(`  PASS  ${testName}`);
    } else {
        failCount++;
        failures.push({ testName, detail });
        console.log(`  FAIL  ${testName}${detail ? ': ' + detail : ''}`);
    }
}

function assertContains(haystack, needle, testName) {
    assert(haystack.includes(needle), testName, `Expected to find: ${needle}`);
}

// Simple attribute extractor: given HTML text and an element id, extract the
// full opening tag so we can check attributes without a real DOM parser.
function extractOpeningTag(html, id) {
    // Match any opening tag that contains id="<id>" or id='<id>'
    const pattern = new RegExp(`<[^>]+id=["']${escapeRegex(id)}["'][^>]*>`, 'i');
    const match = html.match(pattern);
    return match ? match[0] : null;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tagHasAttribute(tag, attrName, attrValue = null) {
    if (tag === null) return false;
    if (attrValue === null) {
        // Just check for presence of the attribute name
        return new RegExp(`\\b${escapeRegex(attrName)}\\b`, 'i').test(tag);
    }
    // Check name="value" or name='value'
    return (
        new RegExp(`${escapeRegex(attrName)}=["']${escapeRegex(attrValue)}["']`, 'i').test(tag)
    );
}

// ---------------------------------------------------------------------------
// Load the HTML file
// ---------------------------------------------------------------------------

console.log('');
console.log('Power Limiting UI Test - PR #2482');
console.log('='.repeat(60));
console.log(`HTML file: ${configHtmlPath}`);
console.log('');

if (!existsSync(configHtmlPath)) {
    console.log(`FATAL: File not found: ${configHtmlPath}`);
    process.exit(2);
}

const html = readFileSync(configHtmlPath, 'utf-8');
console.log(`Loaded ${html.length} bytes of HTML`);
console.log('');

// ---------------------------------------------------------------------------
// Test Suite 1: Section wrapper / title / note
// ---------------------------------------------------------------------------

console.log('Suite 1: Section structure');

// Test 1: Section title element
assertContains(
    html,
    'data-i18n="configurationPowerLimits"',
    'Section title has data-i18n="configurationPowerLimits"'
);

// Test 2: Section title tooltip
assertContains(
    html,
    'data-i18n_title="configurationPowerLimitsHelp"',
    'Section title tooltip has data-i18n_title="configurationPowerLimitsHelp"'
);

// Test 3: Note paragraph
assertContains(
    html,
    'data-i18n="configurationPowerLimitsNote"',
    'Note paragraph has data-i18n="configurationPowerLimitsNote"'
);

// ---------------------------------------------------------------------------
// Test Suite 2: Input field definitions
// Each entry: [id, min, max, dataSetting]
// ---------------------------------------------------------------------------

console.log('');
console.log('Suite 2: Input field presence and attributes');

const expectedFields = [
    // id                                  min    max     data-setting
    ['limit_cont_current',                 '0',   '2000', 'limit_cont_current'],
    ['limit_burst_current',                '0',   '2000', 'limit_burst_current'],
    ['limit_burst_current_time',           '0',   '600',  'limit_burst_current_time'],
    ['limit_burst_current_falldown_time',  '0',   '600',  'limit_burst_current_falldown_time'],
    ['limit_cont_power',                   '0',   '20000','limit_cont_power'],
    ['limit_burst_power',                  '0',   '20000','limit_burst_power'],
    ['limit_burst_power_time',             '0',   '600',  'limit_burst_power_time'],
    ['limit_burst_power_falldown_time',    '0',   '600',  'limit_burst_power_falldown_time'],
];

for (const [id, min, max, dataSetting] of expectedFields) {
    const tag = extractOpeningTag(html, id);

    // Test: input element exists
    assert(tag !== null, `Input #${id} exists in HTML`);

    if (tag !== null) {
        // Test: type="number"
        assert(
            tagHasAttribute(tag, 'type', 'number'),
            `#${id} has type="number"`,
            `Tag: ${tag}`
        );

        // Test: min attribute
        assert(
            tagHasAttribute(tag, 'min', min),
            `#${id} has min="${min}"`,
            `Tag: ${tag}`
        );

        // Test: max attribute
        assert(
            tagHasAttribute(tag, 'max', max),
            `#${id} has max="${max}"`,
            `Tag: ${tag}`
        );

        // Test: step="1"
        assert(
            tagHasAttribute(tag, 'step', '1'),
            `#${id} has step="1"`,
            `Tag: ${tag}`
        );

        // Test: data-setting binding
        assert(
            tagHasAttribute(tag, 'data-setting', dataSetting),
            `#${id} has data-setting="${dataSetting}"`,
            `Tag: ${tag}`
        );

        // Test: batteryProfileHighlight class
        assert(
            tag.includes('batteryProfileHighlight'),
            `#${id} has class containing "batteryProfileHighlight"`,
            `Tag: ${tag}`
        );
    } else {
        // Skip attribute tests if element not found (already counted as FAIL above)
        failCount += 5; // type, min, max, step, data-setting
        failures.push({ testName: `#${id} attribute tests`, detail: 'Input element not found, skipping 5 attribute checks' });
        console.log(`  FAIL  #${id} attribute tests: Input element not found (5 checks skipped)`);

        // Also count class check
        failCount++;
        failures.push({ testName: `#${id} batteryProfileHighlight`, detail: 'Input element not found' });
        console.log(`  FAIL  #${id} has class containing "batteryProfileHighlight": Input element not found`);
    }
}

// ---------------------------------------------------------------------------
// Test Suite 3: Labels (each input must have a corresponding label with data-i18n span)
// ---------------------------------------------------------------------------

console.log('');
console.log('Suite 3: Labels with data-i18n spans');

const expectedLabels = [
    ['limit_cont_current',               'configurationLimitContCurrent'],
    ['limit_burst_current',              'configurationLimitBurstCurrent'],
    ['limit_burst_current_time',         'configurationLimitBurstCurrentTime'],
    ['limit_burst_current_falldown_time','configurationLimitBurstCurrentFalldownTime'],
    ['limit_cont_power',                 'configurationLimitContPower'],
    ['limit_burst_power',                'configurationLimitBurstPower'],
    ['limit_burst_power_time',           'configurationLimitBurstPowerTime'],
    ['limit_burst_power_falldown_time',  'configurationLimitBurstPowerFalldownTime'],
];

for (const [id, i18nKey] of expectedLabels) {
    // A label for="<id>" should exist
    assertContains(
        html,
        `for="${id}"`,
        `Label or element with for="${id}" exists`
    );

    // The i18n key for the label span should exist
    assertContains(
        html,
        `data-i18n="${i18nKey}"`,
        `Label span has data-i18n="${i18nKey}"`
    );
}

// ---------------------------------------------------------------------------
// Test Suite 4: Help tooltips
// ---------------------------------------------------------------------------

console.log('');
console.log('Suite 4: Help tooltips with data-i18n_title');

const expectedTooltips = [
    'configurationLimitContCurrentHelp',
    'configurationLimitBurstCurrentHelp',
    'configurationLimitBurstCurrentTimeHelp',
    'configurationLimitBurstCurrentFalldownTimeHelp',
    'configurationLimitContPowerHelp',
    'configurationLimitBurstPowerHelp',
    'configurationLimitBurstPowerTimeHelp',
    'configurationLimitBurstPowerFalldownTimeHelp',
];

for (const tooltipKey of expectedTooltips) {
    assertContains(
        html,
        `data-i18n_title="${tooltipKey}"`,
        `Help tooltip data-i18n_title="${tooltipKey}" exists`
    );
}

// ---------------------------------------------------------------------------
// Test Suite 5: Sanity checks
// These verify we are reading the correct file and it has expected stable content.
// ---------------------------------------------------------------------------

console.log('');
console.log('Suite 5: Sanity checks');

// Known stable string present on all branches — confirms we are reading configuration.html
assertContains(
    html,
    'data-i18n="tabConfiguration"',
    'File contains tabConfiguration marker — confirms reading tabs/configuration.html'
);

// VTX section should exist on all branches as a stable anchor element
assertContains(
    html,
    'data-i18n="configurationVTX"',
    'Known stable element (configurationVTX section) present — confirms correct file'
);

// ---------------------------------------------------------------------------
// Results summary
// ---------------------------------------------------------------------------

const totalTests = passCount + failCount;
console.log('');
console.log('='.repeat(60));
console.log(`Results: ${passCount}/${totalTests} passed, ${failCount} failed`);
console.log('');

if (failCount > 0) {
    console.log('FAILED tests:');
    for (const { testName, detail } of failures) {
        console.log(`  - ${testName}${detail ? ': ' + detail : ''}`);
    }
    console.log('');
    console.log('NOTE: If running on maintenance-9.x (before PR #2482), these failures');
    console.log('are EXPECTED — the Power Limiting section has not been merged yet.');
    console.log('Switch to feature-power-limiting-ui branch and re-run to verify the PR.');
    console.log('');
    process.exit(1);
} else {
    console.log('All Power Limiting UI tests PASSED.');
    console.log('The Power Limiting section is present and correctly structured.');
    process.exit(0);
}
