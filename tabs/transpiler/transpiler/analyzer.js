/**
 * INAV Semantic Analyzer
 * 
 * Location: tabs/programming/transpiler/transpiler/analyzer.js
 * 
 * Performs semantic analysis including:
 * - Variable scope checking
 * - Property validation
 * - Dead code detection
 * - Conflict detection
 * - Range validation
 * - Uninitialized variable detection
 */

'use strict';

const { INAV_CONSTANTS } = require('./constants.js');
const apiDefinitions = require('./../api/definitions/index.js');

/**
 * Semantic Analyzer for INAV JavaScript subset
 */
class SemanticAnalyzer {
  constructor() {
    // Build API structure from centralized definitions
    this.inavAPI = this.buildAPIStructure(apiDefinitions);
    
    this.gvarCount = 8;
    this.gvarRanges = { min: -1000000, max: 1000000 };
    this.headingRange = { min: 0, max: 359 };
    
    this.errors = [];
    this.warnings = [];
  }
  
  /**
   * Build API structure from definition files
   * Converts the detailed API definitions into the format needed for validation
   */
  buildAPIStructure(definitions) {
    const api = {};
    
    // Process each top-level API object (flight, override, rc, etc.)
    for (const [key, def] of Object.entries(definitions)) {
      if (!def || typeof def !== 'object') continue;
      
      api[key] = {
        properties: [],
        nested: {},
        methods: [],
        targets: []
      };
      
      // Extract properties and nested objects
      for (const [propKey, propDef] of Object.entries(def)) {
        if (!propDef || typeof propDef !== 'object') continue;
        
        // Check if this is a nested object (has its own properties)
        if (propDef.type === 'object' && propDef.properties) {
          // It's a nested object like flight.mode or override.vtx
          api[key].nested[propKey] = [];
          
          for (const [nestedKey, nestedDef] of Object.entries(propDef.properties)) {
            if (nestedDef && typeof nestedDef === 'object') {
              api[key].nested[propKey].push(nestedKey);
            }
          }
        } else if (propDef.type) {
          // It's a direct property
          api[key].properties.push(propKey);
          
          // Track writable properties for override
          if (key === 'override' && !propDef.readonly) {
            api[key].targets.push(propKey);
          }
        }
        
        // Track methods
        if (propDef.type === 'function') {
          api[key].methods.push(propKey);
        }
      }
    }
    
    return api;
  }
  
  /**
   * Analyze AST and return results
   */
  analyze(ast) {
    this.errors = [];
    this.warnings = [];
    
    if (!ast || !ast.statements || !Array.isArray(ast.statements)) {
      throw new Error('Invalid AST structure');
    }
    
    // Perform all analysis passes
    for (const stmt of ast.statements) {
      this.analyzeStatement(stmt);
    }
    
    // Additional analysis passes
    this.detectDeadCode(ast);
    this.detectConflicts(ast);
    this.detectUninitializedGvars(ast);
    
    // Throw if there are errors
    if (this.errors.length > 0) {
      const errorMsg = 'Semantic errors:\n' + 
        this.errors.map(e => `  - ${e.message}${e.line ? ` (line ${e.line})` : ''}`).join('\n');
      throw new Error(errorMsg);
    }
    
    return {
      ast,
      warnings: this.warnings
    };
  }
  
  /**
   * Analyze a single statement
   */
  analyzeStatement(stmt) {
    if (!stmt) return;
    
    switch (stmt.type) {
      case 'Assignment':
        this.checkAssignment(stmt);
        break;
      case 'EventHandler':
        this.checkEventHandler(stmt);
        break;
    }
  }
  
  /**
   * Check assignment statement
   */
  checkAssignment(stmt) {
    const line = stmt.loc ? stmt.loc.start.line : 0;
    
    // Check if target is valid
    if (stmt.target.startsWith('gvar[')) {
      const index = this.extractGvarIndex(stmt.target);
      if (index === -1) {
        this.errors.push({
          message: `Invalid gvar syntax: ${stmt.target}`,
          line
        });
      } else if (index >= this.gvarCount) {
        this.errors.push({
          message: `Invalid gvar index ${index}. INAV only has gvar[0] through gvar[${this.gvarCount - 1}]`,
          line
        });
      }
    } else if (!this.isValidWritableProperty(stmt.target)) {
      this.errors.push({
        message: `Cannot assign to '${stmt.target}'. Not a valid INAV writable property.`,
        line
      });
    }
    
    // Check if value references are valid
    if (typeof stmt.value === 'string') {
      this.checkPropertyAccess(stmt.value, line);
    }
    
    // Check arithmetic operands
    if (stmt.operation) {
      this.checkPropertyAccess(stmt.left, line);
      if (typeof stmt.right === 'string') {
        this.checkPropertyAccess(stmt.right, line);
      }
    }
    
    // Range validation
    this.checkValueRanges(stmt, line);
  }
  
  /**
   * Check value ranges for assignments
   */
  checkValueRanges(stmt, line) {
    // Get the property definition to check ranges
    const propDef = this.getPropertyDefinition(stmt.target);
    
    if (propDef && propDef.range && typeof stmt.value === 'number') {
      const [min, max] = propDef.range;
      if (stmt.value < min || stmt.value > max) {
        this.warnings.push({
          type: 'range',
          message: `Value ${stmt.value} outside valid range (${min}-${max}) for '${stmt.target}'`,
          line
        });
      }
    }
    
    // Fallback checks for legacy code
    // Check heading range
    if (stmt.target === 'override.heading' || stmt.target.includes('heading')) {
      if (typeof stmt.value === 'number') {
        if (stmt.value < this.headingRange.min || stmt.value > this.headingRange.max) {
          this.warnings.push({
            type: 'range',
            message: `Heading value ${stmt.value} outside valid range (${this.headingRange.min}-${this.headingRange.max})`,
            line
          });
        }
      }
    }
    
    // Check gvar value ranges
    if (stmt.target.startsWith('gvar[')) {
      if (typeof stmt.value === 'number') {
        if (stmt.value < this.gvarRanges.min || stmt.value > this.gvarRanges.max) {
          this.warnings.push({
            type: 'range',
            message: `Value ${stmt.value} may overflow gvar storage (${this.gvarRanges.min} to ${this.gvarRanges.max})`,
            line
          });
        }
      }
    }
  }
  
  /**
   * Get property definition from API definitions
   */
  getPropertyDefinition(propPath) {
    const parts = propPath.split('.');
    
    if (parts.length < 2) return null;
    
    const [obj, prop, ...rest] = parts;
    const apiDef = apiDefinitions[obj];
    
    if (!apiDef) return null;
    
    // Direct property
    if (apiDef[prop]) {
      if (rest.length === 0) {
        return apiDef[prop];
      }
      // Nested property
      if (apiDef[prop].properties && apiDef[prop].properties[rest[0]]) {
        return apiDef[prop].properties[rest[0]];
      }
    }
    
    return null;
  }
  
  /**
   * Check event handler
   */
  checkEventHandler(stmt) {
    const line = stmt.loc ? stmt.loc.start.line : 0;
    
    // Check if handler is supported
    const validHandlers = ['on.arm', 'on.always', 'when'];
    if (!validHandlers.includes(stmt.handler)) {
      this.errors.push({
        message: `Unknown event handler: ${stmt.handler}. Valid handlers: ${validHandlers.join(', ')}`,
        line
      });
    }
    
    // Check condition in 'when' statements
    if (stmt.condition) {
      this.checkCondition(stmt.condition, line);
    }
    
    // Check body statements
    if (stmt.body && Array.isArray(stmt.body)) {
      for (const bodyStmt of stmt.body) {
        this.analyzeStatement(bodyStmt);
      }
    }
  }
  
  /**
   * Check condition expression recursively
   */
  checkCondition(condition, line) {
    if (!condition) return;
    
    switch (condition.type) {
      case 'BinaryExpression':
        this.checkPropertyAccess(condition.left, line);
        if (typeof condition.right === 'string') {
          this.checkPropertyAccess(condition.right, line);
        }
        break;
        
      case 'MemberExpression':
        if (condition.value) {
          this.checkPropertyAccess(condition.value, line);
        }
        break;
        
      case 'LogicalExpression':
        this.checkCondition(condition.left, line);
        this.checkCondition(condition.right, line);
        break;
        
      case 'UnaryExpression':
        this.checkCondition(condition.argument, line);
        break;
        
      case 'Identifier':
        if (condition.value) {
          this.checkPropertyAccess(condition.value, line);
        }
        break;
    }
  }
  
  /**
   * Check if property access is valid
   */
  checkPropertyAccess(propPath, line) {
    if (!propPath || typeof propPath !== 'string') return;
    
    // Handle gvar access
    if (propPath.startsWith('gvar[')) {
      const index = this.extractGvarIndex(propPath);
      if (index === -1) {
        this.errors.push({
          message: `Invalid gvar syntax: ${propPath}`,
          line
        });
      } else if (index >= this.gvarCount) {
        this.errors.push({
          message: `Invalid gvar index ${index}. INAV only has gvar[0] through gvar[${this.gvarCount - 1}]`,
          line
        });
      }
      return;
    }
    
    const parts = propPath.split('.');
    
    // Check first level (flight, override, rc, time, etc.)
    if (!this.inavAPI[parts[0]]) {
      this.errors.push({
        message: `Unknown API object '${parts[0]}' in '${propPath}'. Available: ${Object.keys(this.inavAPI).join(', ')}`,
        line
      });
      return;
    }
    
    const apiObj = this.inavAPI[parts[0]];
    
    // For single-level access (e.g., "flight"), warn that it needs a property
    if (parts.length === 1) {
      if (apiObj.properties.length > 0 || Object.keys(apiObj.nested).length > 0) {
        this.warnings.push({
          type: 'incomplete-access',
          message: `'${propPath}' needs a property. Did you mean to access a specific property?`,
          line
        });
      }
      return;
    }
    
    // Check second level
    if (parts.length > 1) {
      const secondPart = parts[1];
      
      // Check if it's a valid property
      if (apiObj.properties.includes(secondPart)) {
        return; // Valid property
      }
      
      // Check if it's a nested object
      if (apiObj.nested[secondPart]) {
        // Check third level if present
        if (parts.length > 2) {
          const thirdPart = parts[2];
          const nestedProps = apiObj.nested[secondPart];
          if (!nestedProps.includes(thirdPart)) {
            this.errors.push({
              message: `Unknown property '${thirdPart}' in '${propPath}'. Available: ${nestedProps.join(', ')}`,
              line
            });
          }
        }
        return;
      }
      
      // Property not found
      const available = [
        ...apiObj.properties,
        ...Object.keys(apiObj.nested)
      ];
      this.errors.push({
        message: `Unknown property '${secondPart}' in '${propPath}'. Available: ${available.join(', ')}`,
        line
      });
    }
  }
  
  /**
   * Check if property can be written to
   */
  isValidWritableProperty(target) {
    // Only gvar and specific override properties can be assigned
    if (target.startsWith('gvar[')) return true;
    
    if (target.startsWith('override.')) {
      const parts = target.split('.');
      if (parts.length >= 2) {
        const apiObj = this.inavAPI['override'];
        
        // Check direct properties
        if (apiObj.targets.includes(parts[1])) {
          return true;
        }
        
        // Check nested properties (e.g., override.vtx.power)
        if (parts.length >= 3 && apiObj.nested[parts[1]]) {
          return apiObj.nested[parts[1]].includes(parts[2]);
        }
      }
    }
    
    return false;
  }
  
  /**
   * Extract gvar index from string
   */
  extractGvarIndex(gvarStr) {
    const match = gvarStr.match(/gvar\[(\d+)\]/);
    return match ? parseInt(match[1]) : -1;
  }
  
  /**
   * Detect dead code (unreachable code)
   */
  detectDeadCode(ast) {
    for (const stmt of ast.statements) {
      if (stmt && stmt.type === 'EventHandler' && stmt.condition) {
        const line = stmt.loc ? stmt.loc.start.line : 0;
        
        // Check for always-false conditions
        const alwaysFalse = this.isAlwaysFalse(stmt.condition);
        if (alwaysFalse) {
          this.warnings.push({
            type: 'dead-code',
            message: 'Unreachable code: condition is always false',
            line
          });
        }
        
        // Check for always-true conditions
        const alwaysTrue = this.isAlwaysTrue(stmt.condition);
        if (alwaysTrue) {
          this.warnings.push({
            type: 'optimization',
            message: 'Condition is always true, consider using on.always instead',
            line
          });
        }
      }
    }
  }
  
  /**
   * Check if condition is always false
   */
  isAlwaysFalse(condition) {
    if (!condition) return false;
    
    if (condition.type === 'BinaryExpression') {
      const { operator, left, right } = condition;
      
      // Same identifier compared: x !== x
      if (operator === '!==' && left === right && typeof left === 'string') {
        return true;
      }
      
      // Literal comparisons that are always false
      if (typeof left === 'number' && typeof right === 'number') {
        switch (operator) {
          case '>': return left <= right;
          case '<': return left >= right;
          case '>=': return left < right;
          case '<=': return left > right;
          case '===': return left !== right;
          case '!==': return left === right;
        }
      }
    }
    
    if (condition.type === 'LogicalExpression') {
      if (condition.operator === '&&') {
        // Both must be true; if either is always false, result is false
        return this.isAlwaysFalse(condition.left) || this.isAlwaysFalse(condition.right);
      }
      if (condition.operator === '||') {
        // At least one must be true; if both always false, result is false
        return this.isAlwaysFalse(condition.left) && this.isAlwaysFalse(condition.right);
      }
    }
    
    if (condition.type === 'Literal') {
      return condition.value === false;
    }
    
    return false;
  }
  
  /**
   * Check if condition is always true
   */
  isAlwaysTrue(condition) {
    if (!condition) return false;
    
    if (condition.type === 'BinaryExpression') {
      const { operator, left, right } = condition;
      
      // Same identifier compared: x === x
      if (operator === '===' && left === right && typeof left === 'string') {
        return true;
      }
      
      // Literal comparisons that are always true
      if (typeof left === 'number' && typeof right === 'number') {
        switch (operator) {
          case '>': return left > right;
          case '<': return left < right;
          case '>=': return left >= right;
          case '<=': return left <= right;
          case '===': return left === right;
          case '!==': return left !== right;
        }
      }
    }
    
    if (condition.type === 'LogicalExpression') {
      if (condition.operator === '||') {
        // At least one must be true; if either is always true, result is true
        return this.isAlwaysTrue(condition.left) || this.isAlwaysTrue(condition.right);
      }
      if (condition.operator === '&&') {
        // Both must be true; if both always true, result is true
        return this.isAlwaysTrue(condition.left) && this.isAlwaysTrue(condition.right);
      }
    }
    
    if (condition.type === 'Literal') {
      return condition.value === true;
    }
    
    return false;
  }
  
  /**
   * Detect conflicting assignments
   */
  detectConflicts(ast) {
    // Track assignments by handler type and target
    const handlerAssignments = new Map();
    
    for (const stmt of ast.statements) {
      if (stmt && stmt.type === 'EventHandler') {
        const handlerKey = stmt.handler === 'when' ? 
          `when:${this.serializeCondition(stmt.condition)}` : 
          stmt.handler;
        
        if (!handlerAssignments.has(handlerKey)) {
          handlerAssignments.set(handlerKey, new Map());
        }
        
        if (stmt.body && Array.isArray(stmt.body)) {
          this.collectAssignments(stmt.body, handlerKey, handlerAssignments.get(handlerKey));
        }
      }
    }
    
    // Check for race conditions between on.always handlers
    const alwaysHandlers = [];
    for (const [handler, assignments] of handlerAssignments.entries()) {
      if (handler === 'on.always') {
        alwaysHandlers.push(assignments);
      }
    }
    
    if (alwaysHandlers.length > 1) {
      // Check if multiple on.always write to same variables
      const targetsSeen = new Set();
      for (const assignments of alwaysHandlers) {
        for (const target of assignments.keys()) {
          if (targetsSeen.has(target)) {
            this.warnings.push({
              type: 'race-condition',
              message: `Multiple on.always handlers write to '${target}'. Execution order is undefined.`,
              line: 0
            });
          }
          targetsSeen.add(target);
        }
      }
    }
    
    // Check for multiple assignments within same handler
    for (const [handler, assignments] of handlerAssignments.entries()) {
      for (const [target, locations] of assignments.entries()) {
        if (locations.length > 1) {
          const lines = locations.map(loc => loc.line).join(', ');
          this.warnings.push({
            type: 'conflict',
            message: `Multiple assignments to '${target}' in ${handler} (lines: ${lines}). Last assignment wins.`,
            line: locations[0].line
          });
        }
      }
    }
  }
  
  /**
   * Serialize condition for comparison
   */
  serializeCondition(condition) {
    if (!condition) return 'null';
    return JSON.stringify(condition);
  }
  
  /**
   * Collect all assignments in body
   */
  collectAssignments(body, handler, assignments) {
    for (const stmt of body) {
      if (stmt && stmt.type === 'Assignment') {
        const target = stmt.target;
        const line = stmt.loc ? stmt.loc.start.line : 0;
        
        if (!assignments.has(target)) {
          assignments.set(target, []);
        }
        
        assignments.get(target).push({ handler, line });
      }
    }
  }
  
  /**
   * Detect uninitialized gvars
   */
  detectUninitializedGvars(ast) {
    const initialized = new Set();
    const used = new Set();
    
    for (const stmt of ast.statements) {
      if (stmt && stmt.type === 'EventHandler') {
        // Track which gvars are written
        if (stmt.body && Array.isArray(stmt.body)) {
          for (const bodyStmt of stmt.body) {
            if (bodyStmt && bodyStmt.type === 'Assignment') {
              if (bodyStmt.target.startsWith('gvar[')) {
                initialized.add(bodyStmt.target);
              }
              // Check if right side uses gvars
              if (typeof bodyStmt.value === 'string' && bodyStmt.value.startsWith('gvar[')) {
                used.add(bodyStmt.value);
              }
              if (bodyStmt.operation) {
                if (typeof bodyStmt.left === 'string' && bodyStmt.left.startsWith('gvar[')) {
                  used.add(bodyStmt.left);
                }
                if (typeof bodyStmt.right === 'string' && bodyStmt.right.startsWith('gvar[')) {
                  used.add(bodyStmt.right);
                }
              }
            }
          }
        }
        
        // Track which gvars are read in conditions
        if (stmt.condition) {
          this.findGvarReads(stmt.condition, used);
        }
      }
    }
    
    // Warn about gvars used but never initialized
    for (const gvar of used) {
      if (!initialized.has(gvar)) {
        this.warnings.push({
          type: 'uninitialized',
          message: `${gvar} is used but never initialized. Will default to 0.`,
          line: 0
        });
      }
    }
  }
  
  /**
   * Find all gvar reads in a condition
   */
  findGvarReads(condition, used) {
    if (!condition) return;
    
    switch (condition.type) {
      case 'BinaryExpression':
        if (typeof condition.left === 'string' && condition.left.startsWith('gvar[')) {
          used.add(condition.left);
        }
        if (typeof condition.right === 'string' && condition.right.startsWith('gvar[')) {
          used.add(condition.right);
        }
        break;
        
      case 'MemberExpression':
        if (typeof condition.value === 'string' && condition.value.startsWith('gvar[')) {
          used.add(condition.value);
        }
        break;
        
      case 'LogicalExpression':
      case 'UnaryExpression':
        this.findGvarReads(condition.left, used);
        this.findGvarReads(condition.right, used);
        if (condition.argument) {
          this.findGvarReads(condition.argument, used);
        }
        break;
    }
  }
}

module.exports = { SemanticAnalyzer };