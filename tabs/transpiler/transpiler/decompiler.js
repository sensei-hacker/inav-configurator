/**
 * INAV Logic Conditions Decompiler
 * 
 * Location: tabs/programming/transpiler/transpiler/decompiler.js
 * 
 * Converts INAV logic conditions back to JavaScript code.
 * Note: This is lossy - comments, variable names, and some structure is lost.
 */

'use strict';

const { INAV_CONSTANTS } = require('./constants.js');
const {
  OPERAND_TYPE,
  OPERATION,
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
  }
  
  /**
   * Build reverse mapping from operand values to property paths
   * This allows us to map INAV operands back to JavaScript property names
   */
  buildOperandMapping(definitions) {
    const mapping = {
      flight: {},
      override: {},
      rc: {},
      time: {},
      waypoint: {}
    };
    
    // Process each API object
    for (const [objName, objDef] of Object.entries(definitions)) {
      if (!objDef || typeof objDef !== 'object') continue;
      
      // Process properties
      for (const [propName, propDef] of Object.entries(objDef)) {
        if (!propDef || typeof propDef !== 'object') continue;
        
        // Direct property with operand mapping
        if (propDef.inavOperand) {
          const { type, value } = propDef.inavOperand;
          
          if (!mapping[objName][value]) {
            mapping[objName][value] = propName;
          }
        }
        
        // Nested object (e.g., flight.mode, override.vtx)
        if (propDef.type === 'object' && propDef.properties) {
          for (const [nestedName, nestedDef] of Object.entries(propDef.properties)) {
            if (nestedDef && nestedDef.inavOperand) {
              const { type, value } = nestedDef.inavOperand;
              
              if (!mapping[objName][value]) {
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
      [OPERAND_TYPE.WAYPOINT]: 'waypoint'
    };
    
    const objName = typeToObject[objectType];
    if (!objName || !this.operandToProperty[objName]) {
      return null;
    }
    
    return this.operandToProperty[objName][operandValue];
  }
  
  /**
   * Decompile logic conditions to JavaScript
   * @param {Array} logicConditions - Array of logic condition objects
   * @returns {Object} Result with code and metadata
   */
  decompile(logicConditions) {
    this.warnings = [];
    
    if (!logicConditions || !Array.isArray(logicConditions)) {
      return {
        success: false,
        error: 'Invalid logic conditions array',
        code: ''
      };
    }
    
    if (logicConditions.length === 0) {
      return {
        success: true,
        code: this.getEmptyTemplate(),
        warnings: ['No logic conditions found on flight controller']
      };
    }
    
    try {
      // Filter and sort enabled conditions
      const enabled = logicConditions
        .filter(lc => lc && lc.enabled)
        .sort((a, b) => a.index - b.index);
      
      if (enabled.length === 0) {
        return {
          success: true,
          code: this.getEmptyTemplate(),
          warnings: ['All logic conditions are disabled']
        };
      }
      
      // Analyze and group conditions
      const groups = this.analyzeConditions(enabled);
      
      // Generate JavaScript code
      const code = this.generateCode(groups);
      
      return {
        success: true,
        code,
        warnings: this.warnings,
        stats: {
          totalConditions: logicConditions.length,
          enabledConditions: enabled.length,
          groups: groups.length
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Decompilation error: ${error.message}`,
        code: this.getEmptyTemplate()
      };
    }
  }
  
  /**
   * Analyze conditions and group them into logical handlers
   * @param {Array} conditions - Enabled logic conditions
   * @returns {Array} Array of condition groups
   */
  analyzeConditions(conditions) {
    const groups = [];
    const processed = new Set();
    
    for (const lc of conditions) {
      if (processed.has(lc.index)) continue;
      
      // Check if this is an activator condition (always true with delay)
      if (this.isActivator(lc)) {
        const group = this.buildActivatorGroup(lc, conditions, processed);
        if (group) groups.push(group);
        continue;
      }
      
      // Check if this is a conditional statement
      if (this.isCondition(lc)) {
        const group = this.buildConditionalGroup(lc, conditions, processed);
        if (group) groups.push(group);
        continue;
      }
      
      // Standalone action
      const group = this.buildStandaloneAction(lc);
      if (group) {
        groups.push(group);
        processed.add(lc.index);
      }
    }
    
    return groups;
  }
  
  /**
   * Check if logic condition is an activator (on.arm, on.always)
   * @param {Object} lc - Logic condition
   * @returns {boolean}
   */
  isActivator(lc) {
    // Activators are typically TRUE operation or ARM_TIMER based
    return lc.operation === OPERATION.TRUE || 
           (lc.operandAType === OPERAND_TYPE.FLIGHT && lc.operandAValue === 0); // armTimer
  }
  
  /**
   * Check if logic condition is a conditional check
   * @param {Object} lc - Logic condition
   * @returns {boolean}
   */
  isCondition(lc) {
    const conditionalOps = [
      OPERATION.EQUAL, OPERATION.GREATER_THAN, OPERATION.LOWER_THAN,
      OPERATION.LOW, OPERATION.MID, OPERATION.HIGH,
      OPERATION.AND, OPERATION.OR, OPERATION.NOT
    ];
    return conditionalOps.includes(lc.operation);
  }
  
  /**
   * Build an activator group (on.arm, on.always)
   * @param {Object} activatorLC - Activator logic condition
   * @param {Array} allConditions - All conditions
   * @param {Set} processed - Set of processed indices
   * @returns {Object|null} Group object
   */
  buildActivatorGroup(activatorLC, allConditions, processed) {
    processed.add(activatorLC.index);
    
    // Find actions activated by this condition
    const actions = allConditions.filter(lc => 
      !processed.has(lc.index) && 
      lc.activatorId === activatorLC.index &&
      this.isAction(lc)
    );
    
    // Mark actions as processed
    actions.forEach(lc => processed.add(lc.index));
    
    // Determine handler type
    let handlerType = 'on.always';
    const config = {};
    
    // Check if it's on.arm (has delay on armTimer)
    if (activatorLC.operandAType === OPERAND_TYPE.FLIGHT && 
        activatorLC.operandAValue === 0 && // armTimer
        activatorLC.operation === OPERATION.GREATER_THAN) {
      handlerType = 'on.arm';
      config.delay = Math.floor(activatorLC.operandBValue / 1000); // Convert ms to seconds
    }
    
    return {
      type: 'activator',
      handler: handlerType,
      config,
      actions: actions.map(lc => this.decompileAction(lc)),
      activatorIndex: activatorLC.index
    };
  }
  
  /**
   * Build a conditional group (when)
   * @param {Object} conditionLC - Condition logic condition
   * @param {Array} allConditions - All conditions
   * @param {Set} processed - Set of processed indices
   * @returns {Object|null} Group object
   */
  buildConditionalGroup(conditionLC, allConditions, processed) {
    processed.add(conditionLC.index);
    
    // Find actions activated by this condition
    const actions = allConditions.filter(lc => 
      !processed.has(lc.index) && 
      lc.activatorId === conditionLC.index &&
      this.isAction(lc)
    );
    
    // Mark actions as processed
    actions.forEach(lc => processed.add(lc.index));
    
    // Decompile condition
    const condition = this.decompileCondition(conditionLC);
    
    return {
      type: 'conditional',
      handler: 'when',
      condition,
      actions: actions.map(lc => this.decompileAction(lc)),
      conditionIndex: conditionLC.index
    };
  }
  
  /**
   * Build a standalone action
   * @param {Object} lc - Logic condition
   * @returns {Object|null} Group object
   */
  buildStandaloneAction(lc) {
    if (!this.isAction(lc)) return null;
    
    return {
      type: 'standalone',
      actions: [this.decompileAction(lc)]
    };
  }
  
  /**
   * Check if logic condition is an action
   * @param {Object} lc - Logic condition
   * @returns {boolean}
   */
  isAction(lc) {
    const actionOps = [
      OPERATION.SET_GVAR, OPERATION.INC_GVAR, OPERATION.DEC_GVAR,
      OPERATION.SET_OVERRIDE, OPERATION.OVERRIDE_THROTTLE_SCALE,
      OPERATION.OVERRIDE_VTX_POWER, OPERATION.OVERRIDE_VTX_BAND,
      OPERATION.OVERRIDE_VTX_CHANNEL
    ];
    return actionOps.includes(lc.operation);
  }
  
  /**
   * Decompile a condition to JavaScript expression
   * @param {Object} lc - Logic condition
   * @returns {string} JavaScript condition expression
   */
  decompileCondition(lc) {
    const left = this.decompileOperand(lc.operandAType, lc.operandAValue);
    const right = this.decompileOperand(lc.operandBType, lc.operandBValue);
    
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
        return `(${left}) && (${right})`;
        
      case OPERATION.OR:
        return `(${left}) || (${right})`;
        
      case OPERATION.NOT:
        return `!(${left})`;
        
      default:
        this.warnings.push(`Unknown operation ${lc.operation} in condition`);
        return 'true';
    }
  }
  
  /**
   * Decompile an action to JavaScript statement
   * @param {Object} lc - Logic condition
   * @returns {string} JavaScript statement
   */
  decompileAction(lc) {
    const target = this.decompileOperand(lc.operandAType, lc.operandAValue);
    const value = this.decompileOperand(lc.operandBType, lc.operandBValue);
    
    switch (lc.operation) {
      case OPERATION.SET_GVAR:
        return `gvar[${lc.operandAValue}] = ${value}`;
        
      case OPERATION.INC_GVAR:
        return `gvar[${lc.operandAValue}] = gvar[${lc.operandAValue}] + ${value}`;
        
      case OPERATION.DEC_GVAR:
        return `gvar[${lc.operandAValue}] = gvar[${lc.operandAValue}] - ${value}`;
        
      case OPERATION.OVERRIDE_THROTTLE_SCALE:
        return `override.throttleScale = ${value}`;
        
      case OPERATION.OVERRIDE_VTX_POWER:
        return `override.vtx.power = ${value}`;
        
      case OPERATION.OVERRIDE_VTX_BAND:
        return `override.vtx.band = ${value}`;
        
      case OPERATION.OVERRIDE_VTX_CHANNEL:
        return `override.vtx.channel = ${value}`;
        
      case OPERATION.ADD:
        return `${target} = ${this.decompileOperand(lc.operandAType, lc.operandAValue)} + ${value}`;
        
      case OPERATION.SUB:
        return `${target} = ${this.decompileOperand(lc.operandAType, lc.operandAValue)} - ${value}`;
        
      case OPERATION.MUL:
        return `${target} = ${this.decompileOperand(lc.operandAType, lc.operandAValue)} * ${value}`;
        
      case OPERATION.DIV:
        return `${target} = ${this.decompileOperand(lc.operandAType, lc.operandAValue)} / ${value}`;
        
      default:
        this.warnings.push(`Unknown operation ${lc.operation} in action`);
        return `// Unknown operation: ${lc.operation}`;
    }
  }
  
  /**
   * Decompile an operand to JavaScript expression
   * Uses centralized API definitions for property names
   * @param {number} type - Operand type
   * @param {number} value - Operand value
   * @returns {string} JavaScript expression
   */
  decompileOperand(type, value) {
    switch (type) {
      case OPERAND_TYPE.VALUE:
        return value.toString();
        
      case OPERAND_TYPE.GVAR:
        return `gvar[${value}]`;
        
      case OPERAND_TYPE.FLIGHT:
        // Try to get from API definitions first
        const flightProp = this.getPropertyFromOperand(OPERAND_TYPE.FLIGHT, value);
        if (flightProp) {
          return `flight.${flightProp}`;
        }
        
        // Fallback to inav_constants.js
        const param = getFlightParamName(value);
        if (param.startsWith('unknown')) {
          this.warnings.push(`Unknown flight parameter: ${value}`);
        }
        return `flight.${param}`;
        
      case OPERAND_TYPE.WAYPOINT:
        // Try to get from API definitions
        const waypointProp = this.getPropertyFromOperand(OPERAND_TYPE.WAYPOINT, value);
        if (waypointProp) {
          return `waypoint.${waypointProp}`;
        }
        
        this.warnings.push(`Waypoint operand (${value}) - not fully supported`);
        return `waypoint[${value}]`;
        
      case OPERAND_TYPE.GET_LC_VALUE:
        // Reference to another logic condition result
        // This is complex - for now, just note it
        this.warnings.push(`Logic condition reference (LC${value}) - may need manual review`);
        return `/* LC${value} result */`;
        
      case OPERAND_TYPE.PID:
        this.warnings.push(`PID operand (${value}) - not fully supported`);
        return `pid[${value}]`;
        
      case OPERAND_TYPE.PROGRAMMING_PID:
        this.warnings.push(`Programming PID operand (${value}) - not fully supported`);
        return `programmingPid[${value}]`;
        
      default:
        this.warnings.push(`Unknown operand type: ${type}`);
        return `unknown_${type}_${value}`;
    }
  }
  
  /**
   * Generate JavaScript code from groups
   * @param {Array} groups - Condition groups
   * @returns {string} JavaScript code
   */
  generateCode(groups) {
    let code = '// INAV Logic Conditions - Decompiled to JavaScript\n';
    code += '// Note: Comments, variable names, and some structure may be lost\n';
    code += '// Please review and test carefully before use\n\n';
    code += 'const { flight, override, rc, gvar, on, when } = inav;\n\n';
    
    for (const group of groups) {
      code += this.generateGroupCode(group);
      code += '\n';
    }
    
    if (this.warnings.length > 0) {
      code += '\n// Decompilation Warnings:\n';
      for (const warning of this.warnings) {
        code += `// - ${warning}\n`;
      }
    }
    
    return code;
  }
  
  /**
   * Generate code for a single group
   * @param {Object} group - Condition group
   * @returns {string} JavaScript code
   */
  generateGroupCode(group) {
    let code = '';
    
    switch (group.type) {
      case 'activator':
        if (group.handler === 'on.arm') {
          code += `on.arm({ delay: ${group.config.delay || 1} }, () => {\n`;
        } else {
          code += 'on.always(() => {\n';
        }
        
        for (const action of group.actions) {
          code += `  ${action};\n`;
        }
        
        code += '});\n';
        break;
        
      case 'conditional':
        code += `when(() => ${group.condition}, () => {\n`;
        
        for (const action of group.actions) {
          code += `  ${action};\n`;
        }
        
        code += '});\n';
        break;
        
      case 'standalone':
        code += '// Standalone action (no clear activator)\n';
        for (const action of group.actions) {
          code += `${action};\n`;
        }
        break;
    }
    
    return code;
  }
  
  /**
   * Get empty template code
   * @returns {string} Template JavaScript
   */
  getEmptyTemplate() {
    return `// INAV JavaScript Programming
// Write JavaScript, get INAV logic conditions!

const { flight, override, rc, gvar, on, when } = inav;

// No logic conditions found on flight controller
// Start writing your code here...

// Example:
// when(() => flight.homeDistance > 100, () => {
//   override.vtx.power = 3;
// });
`;
  }
}

module.exports = { Decompiler };