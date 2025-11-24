/**
 * INAV Logic Conditions Decompiler
 *
 * Location: js/transpiler/transpiler/decompiler.js
 *
 * Converts INAV logic conditions back to JavaScript code.
 * Note: This is lossy - comments, variable names, and some structure is lost.
 */

'use strict';

const {
  OPERAND_TYPE,
  OPERATION,
  FLIGHT_MODE,
  getFlightParamName,
  getOperationName
} = require('./inav_constants.js');
const apiDefinitions = require('./../api/definitions/index.js');

/**
 * Decompiler class
 */
class Decompiler {
  constructor() {
    this.warnings = [];

    // Build reverse mapping from API definitions
    // Maps operand values back to property paths
    this.operandToProperty = this.buildOperandMapping(apiDefinitions);

    // Flight mode names mapping
    this.flightModeNames = {
      [FLIGHT_MODE.FAILSAFE]: 'failsafe',
      [FLIGHT_MODE.MANUAL]: 'manual',
      [FLIGHT_MODE.RTH]: 'rth',
      [FLIGHT_MODE.POSHOLD]: 'poshold',
      [FLIGHT_MODE.CRUISE]: 'cruise',
      [FLIGHT_MODE.ALTHOLD]: 'althold',
      [FLIGHT_MODE.ANGLE]: 'angle',
      [FLIGHT_MODE.HORIZON]: 'horizon',
      [FLIGHT_MODE.AIR]: 'air',
      [FLIGHT_MODE.USER1]: 'user1',
      [FLIGHT_MODE.USER2]: 'user2',
      [FLIGHT_MODE.COURSE_HOLD]: 'courseHold',
      [FLIGHT_MODE.USER3]: 'user3',
      [FLIGHT_MODE.USER4]: 'user4',
      [FLIGHT_MODE.ACRO]: 'acro',
      [FLIGHT_MODE.WAYPOINT_MISSION]: 'waypointMission',
      [FLIGHT_MODE.ANGLEHOLD]: 'anglehold'
    };
  }

  /**
   * Build reverse mapping from operand values to property paths
   * This allows us to map INAV operands back to JavaScript property names
   */
  buildOperandMapping(definitions) {
    const mapping = {};

    for (const objName of Object.keys(definitions)) {
      mapping[objName] = {};
    }

    // Process each API object
    for (const [objName, objDef] of Object.entries(definitions)) {
      if (!objDef || typeof objDef !== 'object') continue;

      // Process properties
      for (const [propName, propDef] of Object.entries(objDef)) {
        if (!propDef || typeof propDef !== 'object') continue;

        // Direct property with operand mapping
        if (propDef.inavOperand) {
          const { type, value } = propDef.inavOperand;

          if (typeof value !== 'undefined' && !mapping[objName][value]) {
            mapping[objName][value] = propName;
          }
        }

        // Nested object (e.g., flight.mode, override.vtx)
        if (propDef.type === 'object' && propDef.properties) {
          for (const [nestedName, nestedDef] of Object.entries(propDef.properties)) {
            if (nestedDef && nestedDef.inavOperand) {
              const { type, value } = nestedDef.inavOperand;

              if (typeof value !== 'undefined' && !mapping[objName][value]) {
                mapping[objName][value] = `${propName}.${nestedName}`;
              }
            }
          }
        }
      }
    }

    return mapping;
  }

  /**
   * Get property name from operand value
   * Uses centralized API definitions
   */
  getPropertyFromOperand(objectType, operandValue) {
    // Map operand types to object names
    const typeToObject = {
      [OPERAND_TYPE.FLIGHT]: 'flight',
      [OPERAND_TYPE.WAYPOINTS]: 'waypoint'
    };

    const objName = typeToObject[objectType];
    if (!objName) return null;

    // Look up in mapping
    if (this.operandToProperty[objName] && this.operandToProperty[objName][operandValue]) {
      return `${objName}.${this.operandToProperty[objName][operandValue]}`;
    }

    return null;
  }

  /**
   * Main decompilation function
   * @param {Array} logicConditions - Array of logic condition objects from FC
   * @returns {Object} Decompilation result with code and metadata
   */
  decompile(logicConditions) {
    this.warnings = [];

    if (!logicConditions || !Array.isArray(logicConditions)) {
      return {
        success: false,
        error: 'Invalid logic conditions array',
        code: '',
        warnings: []
      };
    }

    // Filter enabled conditions
    const enabled = [];
    for (const lc of logicConditions) {
        // Stop at first unused slot (operation 0 = TRUE with no activator usually means unused)
        if (lc.enabled === 0 && lc.operation === 0 && lc.activatorId === -1) {
            break;
        }
        if (lc.enabled) {
            enabled.push(lc);
        }
    }

    if (enabled.length === 0) {
      this.warnings.push('No enabled logic conditions found');
      return {
        success: true,
        code: this.generateBoilerplate('// No logic conditions found'),
        warnings: this.warnings,
        stats: { total: logicConditions.length, enabled: 0, groups: 0 }
      };
    }

    // Group conditions by their structure
    const groups = this.groupConditions(enabled);

    // Generate code for each group (pass enabled conditions for pattern detection)
    const codeBlocks = [];
    for (const group of groups) {
      const code = this.decompileGroup(group, enabled);
      if (code) {
        codeBlocks.push(code);
      }
    }

    const code = this.generateBoilerplate(codeBlocks.join('\n\n'));

    return {
      success: true,
      code,
      warnings: this.warnings,
      stats: {
        total: logicConditions.length,
        enabled: enabled.length,
        groups: groups.length
      }
    };
  }

  /**
   * Detect if a group uses edge/sticky/delay pattern
   * Returns { type: 'edge'|'sticky'|'delay', params } or null
   * @param {Object} group - Group with activator and actions
   * @param {Array} allConditions - All enabled conditions for lookups
   * @returns {Object|null} Pattern detection result
   */
  detectSpecialPattern(group, allConditions) {
    if (!group.activator) return null;

    const activator = group.activator;

    // Check for EDGE pattern
    if (activator.operation === OPERATION.EDGE) {
      // operandA points to the condition LC
      // operandB is the duration
      const conditionId = activator.operandAValue;
      const duration = activator.operandBValue;

      // Find the condition LC
      const conditionLC = allConditions.find(lc => lc.index === conditionId);
      if (conditionLC) {
        return {
          type: 'edge',
          condition: this.decompileCondition(conditionLC, allConditions),
          duration: duration
        };
      }
    }

    // Check for STICKY pattern
    if (activator.operation === OPERATION.STICKY) {
      // operandA points to ON condition LC
      // operandB points to OFF condition LC
      const onConditionId = activator.operandAValue;
      const offConditionId = activator.operandBValue;

      const onLC = allConditions.find(lc => lc.index === onConditionId);
      const offLC = allConditions.find(lc => lc.index === offConditionId);

      if (onLC && offLC) {
        return {
          type: 'sticky',
          onCondition: this.decompileCondition(onLC, allConditions),
          offCondition: this.decompileCondition(offLC, allConditions)
        };
      }
    }

    // Check for DELAY pattern
    if (activator.operation === OPERATION.DELAY) {
      // operandA points to the condition LC
      // operandB is the duration
      const conditionId = activator.operandAValue;
      const duration = activator.operandBValue;

      const conditionLC = allConditions.find(lc => lc.index === conditionId);
      if (conditionLC) {
        return {
          type: 'delay',
          condition: this.decompileCondition(conditionLC, allConditions),
          duration: duration
        };
      }
    }

    // Check for TIMER pattern
    if (activator.operation === OPERATION.TIMER) {
      // operandA is ON duration (ms)
      // operandB is OFF duration (ms)
      // No condition - timer auto-toggles
      const onMs = activator.operandAValue;
      const offMs = activator.operandBValue;

      return {
        type: 'timer',
        onMs: onMs,
        offMs: offMs
      };
    }

    // Check for DELTA (whenChanged) pattern
    if (activator.operation === OPERATION.DELTA) {
      // operandA is the value to monitor
      // operandB is the threshold
      const valueOperand = this.decompileOperand(activator.operandAType, activator.operandAValue, allConditions);
      const threshold = activator.operandBValue;

      return {
        type: 'whenChanged',
        value: valueOperand,
        threshold: threshold
      };
    }

    return null;
  }

  /**
   * Group logic conditions by activator relationships
   * @param {Array} conditions - Enabled logic conditions
   * @returns {Array} Array of condition groups
   */
  groupConditions(conditions) {
    const groups = [];
    const processed = new Set();
    const referencedBySpecialOps = new Set();

    // First pass: find conditions referenced by EDGE/STICKY/DELAY
    for (const lc of conditions) {
        if (lc.operation === OPERATION.EDGE ||
            lc.operation === OPERATION.DELAY) {
            referencedBySpecialOps.add(lc.operandAValue); // operandA points to condition
        } else if (lc.operation === OPERATION.STICKY) {
            referencedBySpecialOps.add(lc.operandAValue); // ON condition
            referencedBySpecialOps.add(lc.operandBValue); // OFF condition
        }
    }


    for (const lc of conditions) {
      if (processed.has(lc.index)) continue;

      // Skip conditions only used by special operations
      if (referencedBySpecialOps.has(lc.index) && lc.activatorId === -1) {
          processed.add(lc.index);
          continue;
      }

      // Root condition (activatorId === -1)
      if (lc.activatorId === -1) {
        const group = {
          activator: lc,
          actions: []
        };

        processed.add(lc.index);

        // Find all actions that use this as activator
        for (const action of conditions) {
          if (action.activatorId === lc.index) {
            group.actions.push(action);
            processed.add(action.index);
          }
        }

        groups.push(group);
      }
    }

    // Handle orphaned actions (actions without root conditions)
    for (const lc of conditions) {
      if (!processed.has(lc.index)) {
        this.warnings.push(`Logic condition ${lc.index} has no valid activator`);
        groups.push({
          activator: null,
          actions: [lc]
        });
        processed.add(lc.index);
      }
    }

    return groups;
  }

  /**
   * Decompile a group (activator + actions)
   * @param {Object} group - Group with activator and actions
   * @param {Array} allConditions - All enabled conditions for pattern detection
   * @returns {string} JavaScript code
   */
  decompileGroup(group, allConditions) {
    if (!group.activator) {
      // Orphaned actions - just decompile them
      const actions = group.actions.map(a => this.decompileAction(a, allConditions)).filter(Boolean);
      return actions.join('\n');
    }

    // Check for special patterns (edge, sticky, delay)
    const pattern = this.detectSpecialPattern(group, allConditions);

    if (pattern) {
      // Decompile actions
      const actions = group.actions.map(a => this.decompileAction(a, allConditions)).filter(Boolean);

      if (actions.length === 0) {
        this.warnings.push(`${pattern.type}() at index ${group.activator.index} has no actions`);
        return '';
      }

      const indent = '  ';
      const body = actions.map(a => indent + a).join('\n');

      // Generate the appropriate syntax
      if (pattern.type === 'edge') {
        return `edge(() => ${pattern.condition}, { duration: ${pattern.duration} }, () => {\n${body}\n});`;
      } else if (pattern.type === 'sticky') {
        return `sticky(() => ${pattern.onCondition}, () => ${pattern.offCondition}, () => {\n${body}\n});`;
      } else if (pattern.type === 'delay') {
        return `delay(() => ${pattern.condition}, { duration: ${pattern.duration} }, () => {\n${body}\n});`;
      } else if (pattern.type === 'timer') {
        return `timer(${pattern.onMs}, ${pattern.offMs}, () => {\n${body}\n});`;
      } else if (pattern.type === 'whenChanged') {
        return `whenChanged(${pattern.value}, ${pattern.threshold}, () => {\n${body}\n});`;
      }
    }

    // Normal if statement
    const condition = this.decompileCondition(group.activator, allConditions);

    // Decompile actions
    const actions = group.actions.map(a => this.decompileAction(a, allConditions)).filter(Boolean);

    if (actions.length === 0) {
      this.warnings.push(`Condition at index ${group.activator.index} has no actions`);
      return `// Empty condition\nif (${condition}) {\n  // No actions\n}`;
    }

    // Generate if statement
    const indent = '  ';
    const body = actions.map(a => indent + a).join('\n');

    return `if (${condition}) {\n${body}\n}`;
  }

  /**
   * Decompile a condition to JavaScript expression
   * @param {Object} lc - Logic condition
   * @param {Array} allConditions - All conditions for recursive resolution
   * @returns {string} JavaScript expression
   */
  decompileCondition(lc, allConditions = null) {
    const left = this.decompileOperand(lc.operandAType, lc.operandAValue, allConditions);
    const right = this.decompileOperand(lc.operandBType, lc.operandBValue, allConditions);

    switch (lc.operation) {
      case OPERATION.TRUE:
        return 'true';

      case OPERATION.EQUAL:
        return `${left} === ${right}`;

      case OPERATION.GREATER_THAN:
        return `${left} > ${right}`;

      case OPERATION.LOWER_THAN:
        return `${left} < ${right}`;

      case OPERATION.LOW:
        return `${left}.low`;

      case OPERATION.MID:
        return `${left}.mid`;

      case OPERATION.HIGH:
        return `${left}.high`;

      case OPERATION.AND:
        // Try to resolve nested conditions
        return `${left} && ${right}`;

      case OPERATION.OR:
        return `${left} || ${right}`;

      case OPERATION.NOT:
        return `!${left}`;

      case OPERATION.XOR:
        // XOR: true if exactly one operand is true
        return `((${left}) ? !(${right}) : (${right}))`;

      case OPERATION.NAND:
        // NAND: NOT AND
        return `!(${left} && ${right})`;

      case OPERATION.NOR:
        // NOR: NOT OR
        return `!(${left} || ${right})`;

      case OPERATION.APPROX_EQUAL:
        // APPROX_EQUAL: B is within 1% of A
        this.warnings.push(`APPROX_EQUAL operation decompiled as === (1% tolerance not preserved)`);
        return `${left} === ${right}`;

      // Special operations that act as conditions
      case OPERATION.EDGE:
        // Edge uses result of another LC as condition
        // This case shouldn't normally be hit because detectSpecialPattern handles it
        // But include for completeness
        return `${left} /* edge with duration ${right}ms */`;

      case OPERATION.STICKY:
        // Sticky uses two LC results as ON/OFF conditions
        return `${left} /* sticky (on: ${left}, off: ${right}) */`;

      case OPERATION.DELAY:
        // Delay uses result of another LC with timeout
        return `${left} /* delay ${right}ms */`;

      // Mathematical operations (can be used in conditions)
      case OPERATION.ADD:
        return `(${left} + ${right})`;

      case OPERATION.SUB:
        return `(${left} - ${right})`;

      case OPERATION.MUL:
        return `(${left} * ${right})`;

      case OPERATION.DIV:
        return `(${left} / ${right})`;

      case OPERATION.MODULUS:
        return `(${left} % ${right})`;

      case OPERATION.MIN:
        return `Math.min(${left}, ${right})`;

      case OPERATION.MAX:
        return `Math.max(${left}, ${right})`;

      case OPERATION.SIN:
        // SIN: sin(A degrees) * B, or * 500 if B is 0
        if (right === '0') {
          return `(Math.sin(${left} * Math.PI / 180) * 500)`;
        }
        return `(Math.sin(${left} * Math.PI / 180) * ${right})`;

      case OPERATION.COS:
        // COS: cos(A degrees) * B, or * 500 if B is 0
        if (right === '0') {
          return `(Math.cos(${left} * Math.PI / 180) * 500)`;
        }
        return `(Math.cos(${left} * Math.PI / 180) * ${right})`;

      case OPERATION.TAN:
        // TAN: tan(A degrees) * B, or * 500 if B is 0
        if (right === '0') {
          return `(Math.tan(${left} * Math.PI / 180) * 500)`;
        }
        return `(Math.tan(${left} * Math.PI / 180) * ${right})`;

      case OPERATION.MAP_INPUT:
        // MAP_INPUT: scales A from [0:B] to [0:1000]
        return `Math.min(1000, Math.max(0, Math.round(${left} * 1000 / ${right})))`;

      case OPERATION.MAP_OUTPUT:
        // MAP_OUTPUT: scales A from [0:1000] to [0:B]
        return `Math.min(${right}, Math.max(0, Math.round(${left} * ${right} / 1000)))`;

      case OPERATION.TIMER:
        // TIMER: ON for A ms, OFF for B ms
        // This case shouldn't normally be hit because detectSpecialPattern handles it
        // But include for completeness
        return `/* timer(${left}ms ON, ${right}ms OFF) */ true`;

      case OPERATION.DELTA:
        // DELTA: true when A changes by B or more within 100ms
        // This case shouldn't normally be hit because detectSpecialPattern handles it
        // But include for completeness
        return `/* delta(${left}, threshold ${right}) */ true`;

      default:
        this.warnings.push(`Unknown operation ${lc.operation} (${getOperationName(lc.operation)}) in condition`);
        return 'true';
    }
  }

  /**
   * Decompile an action to JavaScript statement
   * @param {Object} lc - Logic condition
   * @param {Array} allConditions - All conditions for recursive resolution
   * @returns {string} JavaScript statement
   */
  decompileAction(lc, allConditions = null) {
    const value = this.decompileOperand(lc.operandBType, lc.operandBValue, allConditions);

    switch (lc.operation) {
      case OPERATION.GVAR_SET:
        // operandA is VALUE type containing the gvar index
        return `gvar[${lc.operandAValue}] = ${value};`;

      case OPERATION.GVAR_INC:
        return `gvar[${lc.operandAValue}] = gvar[${lc.operandAValue}] + ${value};`;

      case OPERATION.GVAR_DEC:
        return `gvar[${lc.operandAValue}] = gvar[${lc.operandAValue}] - ${value};`;

      case OPERATION.OVERRIDE_THROTTLE_SCALE:
        return `override.throttleScale = ${value};`;

      case OPERATION.OVERRIDE_THROTTLE:
        return `override.throttle = ${value};`;

      case OPERATION.SET_VTX_POWER_LEVEL:
        return `override.vtx.power = ${value};`;

      case OPERATION.SET_VTX_BAND:
        return `override.vtx.band = ${value};`;

      case OPERATION.SET_VTX_CHANNEL:
        return `override.vtx.channel = ${value};`;

      case OPERATION.OVERRIDE_ARMING_SAFETY:
        return `override.armSafety = true;`;

      case OPERATION.SET_OSD_LAYOUT:
        return `override.osdLayout = ${value};`;

      case OPERATION.RC_CHANNEL_OVERRIDE:
        // operandA contains channel number (1-18)
        // Use cleaner array syntax instead of override.rcChannel()
        return `rc[${lc.operandAValue}] = ${value};`;

      case OPERATION.LOITER_OVERRIDE:
        return `override.loiterRadius = ${value};`;

      case OPERATION.OVERRIDE_MIN_GROUND_SPEED:
        return `override.minGroundSpeed = ${value};`;

      case OPERATION.SWAP_ROLL_YAW:
        return `override.swapRollYaw = true;`;

      case OPERATION.INVERT_ROLL:
        return `override.invertRoll = true;`;

      case OPERATION.INVERT_PITCH:
        return `override.invertPitch = true;`;

      case OPERATION.INVERT_YAW:
        return `override.invertYaw = true;`;

      case OPERATION.SET_HEADING_TARGET:
        // Value is in centidegrees
        return `override.headingTarget = ${value};`;

      case OPERATION.SET_PROFILE:
        return `override.profile = ${value};`;

      case OPERATION.FLIGHT_AXIS_ANGLE_OVERRIDE: {
        // operandA is axis (0=roll, 1=pitch, 2=yaw), operandB is angle in degrees
        const axisNames = ['roll', 'pitch', 'yaw'];
        const axisIndex = lc.operandAValue;
        const axisName = axisNames[axisIndex] || axisIndex;
        this.warnings.push(`FLIGHT_AXIS_ANGLE_OVERRIDE may need verification - check API syntax`);
        return `override.flightAxis.${axisName}.angle = ${value};`;
      }

      case OPERATION.FLIGHT_AXIS_RATE_OVERRIDE: {
        // operandA is axis (0=roll, 1=pitch, 2=yaw), operandB is rate in deg/s
        const axisNames = ['roll', 'pitch', 'yaw'];
        const axisIndex = lc.operandAValue;
        const axisName = axisNames[axisIndex] || axisIndex;
        this.warnings.push(`FLIGHT_AXIS_RATE_OVERRIDE may need verification - check API syntax`);
        return `override.flightAxis.${axisName}.rate = ${value};`;
      }

      case OPERATION.SET_GIMBAL_SENSITIVITY:
        return `override.gimbalSensitivity = ${value};`;

      case OPERATION.LED_PIN_PWM:
        // operandA is pin (0-7), operandB is PWM value
        this.warnings.push(`LED_PIN_PWM may need verification - check API syntax`);
        return `override.ledPin(${lc.operandAValue}, ${value});`;

      case OPERATION.PORT_SET:
        // operandA is port (0-7), operandB is value (0 or 1)
        this.warnings.push(`PORT_SET may not be available in JavaScript API`);
        return `/* override.port(${lc.operandAValue}, ${value}); */ // PORT_SET - may not be supported`;

      case OPERATION.DISABLE_GPS_FIX:
        return `override.disableGpsFix = true;`;

      case OPERATION.RESET_MAG_CALIBRATION:
        return `override.resetMagCalibration = true;`;

      case OPERATION.ADD:
      case OPERATION.SUB:
      case OPERATION.MUL:
      case OPERATION.DIV: {
        const target = this.decompileOperand(lc.operandAType, lc.operandAValue, allConditions);
        const ops = { [OPERATION.ADD]: '+', [OPERATION.SUB]: '-', [OPERATION.MUL]: '*', [OPERATION.DIV]: '/' };
        const op = ops[lc.operation];
        return `${target} = ${target} ${op} ${value};`;
      }

      default:
        this.warnings.push(`Unknown operation ${lc.operation} (${getOperationName(lc.operation)}) in action`);
        return `// Unknown operation: ${getOperationName(lc.operation)}`;
    }
  }

  /**
   * Decompile an operand to JavaScript expression
   * Uses centralized API definitions for property names
   * @param {number} type - Operand type
   * @param {number} value - Operand value
   * @param {Array} allConditions - All conditions for recursive resolution
   * @returns {string} JavaScript expression
   */
  decompileOperand(type, value, allConditions = null) {
    switch (type) {
      case OPERAND_TYPE.VALUE:
        return value.toString();

      case OPERAND_TYPE.GVAR:
        return `gvar[${value}]`;

      case OPERAND_TYPE.RC_CHANNEL:
        return `rc[${value}]`;

      case OPERAND_TYPE.FLIGHT:
      case OPERAND_TYPE.WAYPOINTS: {
        // Try to get property name from API definitions
        const prop = this.getPropertyFromOperand(type, value);
        if (prop) {
          return prop;
        }

        // Fallback to flight param name
        const name = getFlightParamName(value);
        const objName = type === OPERAND_TYPE.FLIGHT ? 'flight' : 'waypoint';
        return `${objName}.${name}`;
      }

      case OPERAND_TYPE.FLIGHT_MODE: {
        // Flight modes are boolean flags accessed as flight.mode.name
        const modeName = this.flightModeNames[value];
        if (modeName) {
          return `flight.mode.${modeName}`;
        }

        this.warnings.push(`Unknown flight mode value ${value}`);
        return `flight.mode[${value}] /* unknown mode */`;
      }

      case OPERAND_TYPE.LC:
        // Reference to another logic condition result
        // If we have access to all conditions, recursively resolve
        if (allConditions) {
          const referencedLC = allConditions.find(lc => lc.index === value);
          if (referencedLC) {
            // Recursively decompile the referenced condition
            return this.decompileCondition(referencedLC, allConditions);
          }
        }
        // Fallback to reference notation if we can't resolve
        return `logicCondition[${value}]`;

      case OPERAND_TYPE.PID:
        this.warnings.push(`PID operand (value ${value}) is not supported in JavaScript API`);
        return `/* PID[${value}] */`;

      default:
        this.warnings.push(`Unknown operand type ${type}`);
        return `/* unknown operand type ${type}, value ${value} */`;
    }
  }

  /**
   * Generate boilerplate code with proper formatting
   * @param {string} body - Main code body
   * @returns {string} Complete JavaScript code
   */
  generateBoilerplate(body) {
    let code = '';

    // Add header comment
    code += '// INAV JavaScript Programming\n';
    code += '// Decompiled from logic conditions\n\n';

    // Add destructuring - include edge, sticky, delay, timer, whenChanged if used
    const needsEdge = body.includes('edge(');
    const needsSticky = body.includes('sticky(');
    const needsDelay = body.includes('delay(');
    const needsTimer = body.includes('timer(');
    const needsWhenChanged = body.includes('whenChanged(');
    const needsWaypoint = body.includes('waypoint.');

    const imports = ['flight', 'override', 'rc', 'gvar'];
    if (needsEdge) imports.push('edge');
    if (needsSticky) imports.push('sticky');
    if (needsDelay) imports.push('delay');
    if (needsTimer) imports.push('timer');
    if (needsWhenChanged) imports.push('whenChanged');
    if (needsWaypoint) imports.push('waypoint');

    code += `const { ${imports.join(', ')} } = inav;\n\n`;

    // Add warnings if any
    if (this.warnings.length > 0) {
      code += '// Decompilation Warnings:\n';
      for (const warning of this.warnings) {
        code += `// - ${warning}\n`;
      }
      code += '\n';
    }

    // Add body
    code += body;

    return code;
  }
}

module.exports = { Decompiler };
