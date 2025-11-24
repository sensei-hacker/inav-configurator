# JavaScript Variables in INAV Transpiler

## Overview

The INAV JavaScript transpiler now supports `let`, `const`, and `var` variable declarations, making it easier to write readable and maintainable flight logic code.

## Quick Start

```javascript
const { flight } = inav;

// Constant value - substituted inline
let maxAltitude = 500;

// Mutable variable - allocated to gvar slot
var currentMode = 0;

on.arm(() => {
  currentMode = 1;
});

if (flight.altitude > maxAltitude) {
  currentMode = 2;
}

gvar[0] = currentMode;
```

## Variable Types

### `let` and `const` - Constant Substitution

`let` and `const` variables are treated as compile-time constants. The transpiler substitutes their values inline wherever they're used.

**Example:**
```javascript
let threshold = 1000;

if (flight.altitude > threshold) {
  gvar[0] = 1;
}
```

**Generated logic:**
```
if (flight.altitude > 1000) {
  gvar[0] = 1;
}
```

**Key points:**
- ✅ No gvar slots used
- ✅ Values must be constant (numbers, arithmetic expressions)
- ❌ Cannot be reassigned
- ❌ Cannot use runtime values (flight.altitude, gvar[N])

**Supported initializers:**
```javascript
let a = 100;              // ✅ Literal number
let b = 50 + 50;          // ✅ Arithmetic expression
let c = a + b;            // ✅ Reference to other let/const
const d = 200;            // ✅ const works same as let

let bad = flight.altitude;  // ❌ Runtime value
let bad = gvar[0];          // ❌ Runtime value
```

### `var` - Gvar Allocation

`var` variables are allocated to available gvar slots automatically. The transpiler maps your variable names to gvar[0]-gvar[7].

**Example:**
```javascript
var altitude_threshold = 500;

on.arm(() => {
  altitude_threshold = flight.altitude;
});

if (flight.altitude > altitude_threshold) {
  gvar[0] = 1;
}
```

**Generated logic:**
```
gvar[7] = 500;

on.arm {
  gvar[7] = flight.altitude;
}

if (flight.altitude > gvar[7]) {
  gvar[0] = 1;
}
```

**Key points:**
- ✅ Uses one gvar slot per variable
- ✅ Can be reassigned
- ✅ Can store runtime values
- ⚠️ Limited to 8 total gvar slots (shared with explicit gvar usage)

**Allocation strategy:**
- Variables are allocated from gvar[7] down to gvar[0]
- Avoids slots explicitly used in your code
- Example: If you use gvar[0] and gvar[1], variables get gvar[7], gvar[6], etc.

## Usage Examples

### Example 1: Flight Mode Tracking

```javascript
const { flight, rc } = inav;

// Constants
let manualMode = 0;
let autoMode = 1;
let emergencyMode = 2;

// State variable
var currentFlightMode = manualMode;

on.arm(() => {
  currentFlightMode = rc.aux1 > 1500 ? autoMode : manualMode;
});

on.always(() => {
  if (flight.altitude < 50) {
    currentFlightMode = emergencyMode;
  }
});

gvar[0] = currentFlightMode;
```

### Example 2: Altitude Monitoring

```javascript
const { flight } = inav;

// Safety thresholds
let minSafeAlt = 50;
let maxSafeAlt = 500;

// Track violations
var violations = 0;

on.always(() => {
  if (flight.altitude < minSafeAlt || flight.altitude > maxSafeAlt) {
    violations++;
  }
});

gvar[0] = violations;
```

### Example 3: Mixed Usage

```javascript
const { flight, override } = inav;

// Constants (no gvar usage)
let baseThrottle = 1000;
let maxThrottle = 2000;

// Mutable state (uses gvar)
var adjustedThrottle = baseThrottle;

on.always(() => {
  adjustedThrottle = baseThrottle + flight.altitude;

  if (adjustedThrottle > maxThrottle) {
    adjustedThrottle = maxThrottle;
  }
});

if (flight.mode.failsafe) {
  override.throttle = adjustedThrottle;
}
```

## Gvar Slot Usage

The transpiler tracks gvar usage and displays it in the output:

```
# Gvar Slots Used: 3/8 (1 explicit + 2 variables)
#   Variables: altitude_threshold=gvar[7], violations=gvar[6]
```

**Info messages:**
- **Low usage (1-5 slots):** Info message showing allocation
- **High usage (6-7 slots):** Warning showing remaining slots
- **Full usage (8 slots):** Warning suggesting to use `let` for constants

## Error Handling

### Cannot Reassign `let`/`const`

```javascript
let altitude = 100;
altitude = 200;  // ❌ Error
```

**Error:** `Cannot reassign 'let' variable 'altitude'. Use 'var' for mutable variables.`

**Fix:** Use `var` instead:
```javascript
var altitude = 100;
altitude = 200;  // ✅ OK
```

### Variable Redeclaration

```javascript
let altitude = 100;
let altitude = 200;  // ❌ Error
```

**Error:** `Variable 'altitude' is already declared`

**Fix:** Use different names or update the existing variable

### Gvar Slot Exhaustion

```javascript
// Explicitly use gvar[0] through gvar[4]
gvar[0] = 1;
gvar[1] = 2;
// ... etc ...

// Try to declare 4 var variables
var v1 = 1;  // OK - allocated to gvar[7]
var v2 = 2;  // OK - allocated to gvar[6]
var v3 = 3;  // OK - allocated to gvar[5]
var v4 = 4;  // ❌ Error - no slots left!
```

**Error:** `No available gvar slots for variable 'v4'. All 8 gvar slots are in use.`

**Fix:**
- Use `let`/`const` for constants instead of `var`
- Reduce explicit gvar usage
- Reduce number of `var` variables

## Best Practices

### 1. Prefer `let`/`const` for Constants

```javascript
// ✅ Good - no gvar usage
let maxSpeed = 100;

// ❌ Bad - wastes a gvar slot
var maxSpeed = 100;
```

### 2. Use `var` for Mutable State

```javascript
// ✅ Good - needs to change
var speed = 0;

on.always(() => {
  speed = calculateSpeed();
});
```

### 3. Use Descriptive Names

```javascript
// ✅ Good - clear intent
let minSafeAltitude = 50;
var throttleAdjustment = 0;

// ❌ Bad - unclear
let a = 50;
var x = 0;
```

### 4. Group Related Variables

```javascript
// Configuration constants
let minAlt = 50;
let maxAlt = 500;
let midAlt = 275;

// Runtime state
var currentAlt = 0;
var isInRange = 0;
```

### 5. Monitor Gvar Usage

Check the transpiler output for gvar usage warnings. If you see "High gvar usage", consider converting some `var` declarations to `let` if they don't need to change.

## Limitations

### No Block Scoping

Variables have global scope, even inside `if` blocks or event handlers.

```javascript
if (flight.altitude > 100) {
  let foo = 5;
}
gvar[0] = foo;  // ✅ Works (might be confusing)
```

### No Runtime Expressions in `let`/`const`

```javascript
let altitude = flight.altitude;  // ❌ Error - runtime value
var altitude = flight.altitude;  // ✅ OK - uses gvar slot
```

### Limited to 8 Total Gvar Slots

All gvar usage (explicit + variables) shares the same 8 slots.

```javascript
gvar[0] = 1;  // Explicit usage
gvar[1] = 2;  // Explicit usage

var a = 1;    // Uses gvar[7]
var b = 2;    // Uses gvar[6]
// ... only 4 more slots available
```

### Variable Names Lost in Decompilation

When you download logic conditions from the flight controller, variable names are lost:

**Original:**
```javascript
var altitude_threshold = 500;
```

**Downloaded:**
```javascript
gvar[7] = 500;
```

**Tip:** Keep your source code backed up!

## Migrating Existing Code

### Before (explicit gvar usage):

```javascript
const { flight } = inav;

on.arm(() => {
  gvar[3] = 0;  // Reset counter
});

on.always(() => {
  if (flight.altitude > 500) {
    gvar[3] = gvar[3] + 1;
  }
});

gvar[0] = gvar[3];
```

### After (with variables):

```javascript
const { flight } = inav;

let threshold = 500;
var counter = 0;

on.arm(() => {
  counter = 0;
});

on.always(() => {
  if (flight.altitude > threshold) {
    counter++;
  }
});

gvar[0] = counter;
```

**Benefits:**
- ✅ More readable
- ✅ Self-documenting
- ✅ Easier to maintain
- ✅ Same number of gvar slots used

## Technical Details

### Compilation Process

1. **Parser** - Recognizes variable declarations
2. **Analyzer** - Validates usage, allocates gvar slots
3. **Optimizer** - Optimizes expressions
4. **Code Generator** - Substitutes `let`/`const`, maps `var` to gvar

### Gvar Allocation Algorithm

1. Scan code for explicit `gvar[N]` usage
2. Mark those slots as unavailable
3. Allocate variables from gvar[7] down to gvar[0]
4. Error if all slots exhausted

### Expression Substitution

For `let`/`const`, the transpiler stores the full expression AST and substitutes it inline:

```javascript
let x = 50 + 50;
gvar[0] = x;

// Becomes:
gvar[0] = 50 + 50;
```

This means each use of `x` generates the full expression, not a single value.

## Troubleshooting

### "Variable 'x' is already declared"

You declared the same variable twice. Use different names or remove one declaration.

### "Cannot reassign 'let' variable"

You tried to change a `let`/`const` variable. Use `var` instead.

### "No available gvar slots"

All 8 gvar slots are in use. Solutions:
- Convert constants from `var` to `let`
- Reduce explicit gvar usage
- Reduce number of `var` variables

### "Unknown operand 'varname'"

The variable might not be in scope or declared. Check:
- Variable is declared before use
- Spelling matches exactly
- No typos

### Transpiler works but "Save to FC" fails

This was a bug in early versions. Ensure you're using the latest transpiler version.

## See Also

- [Programming Tab Guide](../../../docs/Programming.md)
- [Logic Conditions Manual](../../../docs/LogicConditions.md)
- [API Reference](../api/README.md)
