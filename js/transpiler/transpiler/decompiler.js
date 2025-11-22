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
    const enabled = logicConditions.filter(lc => lc.enabled);
    
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
    
    // Generate code for each group
    const codeBlocks = [];
    for (const group of groups) {
      const code = this.decompileGroup(group);
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
   * Group logic conditions by activator relationships
   * @param {Array} conditions - Enabled logic conditions
   * @returns {Array} Array of condition groups
   */
  groupConditions(conditions) {
    const groups = [];
    const processed = new Set();
    
    for (const lc of conditions) {
      if (processed.has(lc.index)) continue;
      
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
   * @returns {string} JavaScript code
   */
  decompileGroup(group) {
    if (!group.activator) {
      // Orphaned actions - just decompile them
      const actions = group.actions.map(a => this.decompileAction(a)).filter(Boolean);
      return actions.join('\n');
    }
    
    // Decompile the condition
    const condition = this.decompileCondition(group.activator);
    
    // Decompile actions
    const actions = group.actions.map(a => this.decompileAction(a)).filter(Boolean);
    
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
   * @returns {string} JavaScript expression
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
        this.warnings.push(`Unknown operation ${lc.operation} (${getOperationName(lc.operation)}) in condition`);
        return 'true';
    }
  }
  
  /**
   * Decompile an action to JavaScript statement
   * @param {Object} lc - Logic condition
   * @returns {string} JavaScript statement
   */
  decompileAction(lc) {
    const value = this.decompileOperand(lc.operandBType, lc.operandBValue);
    
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
        return `override.rcChannel(${lc.operandAValue}, ${value});`;
        
      case OPERATION.LOITER_OVERRIDE:
        return `override.loiterRadius = ${value};`;
        
      case OPERATION.OVERRIDE_MIN_GROUND_SPEED:
        return `override.minGroundSpeed = ${value};`;
        
      case OPERATION.ADD:
      case OPERATION.SUB:
      case OPERATION.MUL:
      case OPERATION.DIV: {
        const target = this.decompileOperand(lc.operandAType, lc.operandAValue);
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
   * @returns {string} JavaScript expression
   */
  decompileOperand(type, value) {
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
        
      case OPERAND_TYPE.FLIGHT_MODE:
        // Flight modes are boolean flags
        this.warnings.push(`Flight mode operand (value ${value}) may need manual review`);
        return `flight.mode[${value}]`;
        
      case OPERAND_TYPE.GET_LC_VALUE:
        // Reference to another logic condition result
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
    
    // Add destructuring
    code += 'const { flight, override, rc, gvar } = inav;\n\n';
    
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
