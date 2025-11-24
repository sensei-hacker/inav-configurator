/**
 * INAV Code Generator
 *
 * Location: tabs/programming/transpiler/transpiler/codegen.js
 *
 * Generates INAV logic condition CLI commands from AST.
 * Supports if statements, edge(), sticky(), delay(), and on.* handlers.
 */

'use strict';

import { ArrowFunctionHelper } from './arrow_function_helper.js';
import { ErrorHandler } from './error_handler.js';

import {
  OPERAND_TYPE,
  OPERATION,
  getOperationName
} from './inav_constants.js';
import apiDefinitions from './../api/definitions/index.js';

/**
 * INAV Code Generator
 * Converts AST to INAV logic condition commands
 */
class INAVCodeGenerator {
  constructor(variableHandler = null) {
    this.lcIndex = 0; // Current logic condition index
    this.commands = [];
    this.errorHandler = new ErrorHandler(); // Error and warning collection
    this.operandMapping = this.buildOperandMapping(apiDefinitions);
    this.arrowHelper = new ArrowFunctionHelper(this);
    this.variableHandler = variableHandler;
  }

  /**
   * Build operand mapping from API definitions
   */
  buildOperandMapping(definitions) {
    const mapping = {};

    for (const [objName, objDef] of Object.entries(definitions)) {
      if (!objDef || typeof objDef !== 'object') continue;

      for (const [propName, propDef] of Object.entries(objDef)) {
        if (!propDef || typeof propDef !== 'object') continue;

        // Direct property
        if (propDef.inavOperand) {
          const path = `${objName}.${propName}`;
          mapping[path] = propDef.inavOperand;
        }

        // Nested object
        if (propDef.type === 'object' && propDef.properties) {
          for (const [nestedName, nestedDef] of Object.entries(propDef.properties)) {
            if (nestedDef && nestedDef.inavOperand) {
              const path = `${objName}.${propName}.${nestedName}`;
              mapping[path] = nestedDef.inavOperand;
            }
          }
        }

        // Operation mapping for writable properties
        if (propDef.inavOperation) {
          const path = `${objName}.${propName}`;
          if (!mapping[path]) mapping[path] = {};
          mapping[path].operation = propDef.inavOperation;
        }
      }
    }

    return mapping;
  }

  /**
   * Generate INAV CLI commands from AST
   * @param {Object} ast - Abstract syntax tree
   * @returns {string[]} Array of CLI commands
   */
  generate(ast) {
    this.lcIndex = 0;
    this.commands = [];
    this.errorHandler.reset(); // Clear any previous errors

    if (!ast || !ast.statements) {
      throw new Error('Invalid AST');
    }

    // Generate var initializations at program start
    if (this.variableHandler) {
      const varInits = this.variableHandler.getVarInitializations();
      for (const init of varInits) {
        this.generateVarInitialization(init);
      }
    }

    for (const stmt of ast.statements) {
      this.generateStatement(stmt);
    }

    // Throw if any errors were collected during generation
    this.errorHandler.throwIfErrors();

    return this.commands;
  }

  /**
   * Generate logic condition for a statement
   */
  generateStatement(stmt) {
    if (!stmt) return;
    switch (stmt.type) {
      case 'EventHandler':
        this.generateEventHandler(stmt);
        break;
      case 'Destructuring':
      case 'LetDeclaration':
      case 'VarDeclaration':
        // Skip - declarations handled separately
        break;
      default:
        this.errorHandler.addError(
          `Unsupported statement type: ${stmt.type}. Only assignments and event handlers are supported`,
          stmt,
          'unsupported_statement'
        );
    }
  }

  /**
   * Generate initialization for var variable
   */
  generateVarInitialization(init) {
    // Generate gvar initialization at program start
    const valueOperand = this.getOperand(init.initExpr, -1);

    // Use GVAR_SET to initialize the variable
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.GVAR_SET} ${OPERAND_TYPE.VALUE} ${init.gvarIndex} ${valueOperand.type} ${valueOperand.value} 0`
    );
    this.lcIndex++;
  }

  /**
   * Generate event handler (if statement, edge, sticky, delay, on.*)
   */
  generateEventHandler(stmt) {
    const handler = stmt.handler;

    if (handler === 'on.arm') {
      this.generateOnArm(stmt);
    } else if (handler === 'on.always') {
      this.generateOnAlways(stmt);
    } else if (handler.startsWith('if')) {
      // If statement - generates conditional logic
      this.generateConditional(stmt);
    } else if (handler === 'edge') {
      this.generateEdge(stmt);
    } else if (handler === 'sticky') {
      this.generateSticky(stmt);
    } else if (handler === 'delay') {
      this.generateDelay(stmt);
    } else if (handler === 'timer') {
      this.generateTimer(stmt);
    } else if (handler === 'whenChanged') {
      this.generateWhenChanged(stmt);
    } else {
      // Default: treat as conditional
      this.generateConditional(stmt);
    }
  }

  /**
   * Generate on.arm handler
   * Uses EDGE to trigger once when armed
   */
  generateOnArm(stmt) {
    const delay = stmt.config.delay || 0;

    // Create condition: armTimer > 0 (or flight.isArmed if available)
    const conditionId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.GREATER_THAN} ${OPERAND_TYPE.FLIGHT} 0 ${OPERAND_TYPE.VALUE} 0 0`
    );
    this.lcIndex++;

    // Create EDGE operation (triggers once)
    const edgeId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.EDGE} ${OPERAND_TYPE.LC} ${conditionId} ${OPERAND_TYPE.VALUE} ${delay} 0`
    );
    this.lcIndex++;

    // Generate body actions with EDGE as activator
    for (const action of stmt.body) {
      this.generateAction(action, edgeId);
    }
  }


  /**
   * Generate on.always handler
   */
  generateOnAlways(stmt) {
    // Create activator: always true
    const activatorId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.TRUE} ${OPERAND_TYPE.VALUE} 0 ${OPERAND_TYPE.VALUE} 0 0`
    );
    this.lcIndex++;

    // Generate body actions
    for (const action of stmt.body) {
      this.generateAction(action, activatorId);
    }
  }

  /**
   * Generate conditional (if statement)
   */
  generateConditional(stmt) {
    if (!stmt.condition) return;

    let conditionId;

    // Check if we should reuse an existing condition (CSE optimization)
    if (stmt.reuseCondition) {
      // Find the LC index of the reused condition
      conditionId = stmt.reuseCondition.conditionLcIndex;

      if (conditionId === undefined) {
        // Fallback: generate new condition if reuse fails
        conditionId = this.generateCondition(stmt.condition, -1);
        stmt.conditionLcIndex = conditionId;
      } else {
        // If we need to invert the condition, generate a NOT operation
        if (stmt.invertReuse) {
          const notId = this.lcIndex;
          this.commands.push(
            `logic ${this.lcIndex} 1 -1 ${OPERATION.NOT} ${OPERAND_TYPE.LC} ${conditionId} ${OPERAND_TYPE.VALUE} 0 0`
          );
          this.lcIndex++;
          conditionId = notId;
        }
      }
    } else {
      // Generate new condition logic condition
      conditionId = this.generateCondition(stmt.condition, -1);

      // Store the LC index for potential reuse by other statements
      stmt.conditionLcIndex = conditionId;
    }

    // Generate body actions
    for (const action of stmt.body) {
      this.generateAction(action, conditionId);
    }
  }




  /**
   * Generate edge handler
   * edge(() => condition, { duration: ms }, () => { actions })
   */
  generateEdge(stmt) {
    if (!stmt.args || stmt.args.length < 3) {
      this.errorHandler.addError(
        `edge() requires exactly 3 arguments (condition, duration, action). Got ${stmt.args?.length || 0}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Extract parts using helper
    const condition = this.arrowHelper.extractExpression(stmt.args[0]);
    const duration = this.arrowHelper.extractDuration(stmt.args[1]);
    const actions = this.arrowHelper.extractBody(stmt.args[2]);

    if (!condition) {
      this.errorHandler.addError(
        'edge() argument 1 must be an arrow function',
        stmt,
        'invalid_args'
      );
      return;
    }

    // Generate condition LC
    const conditionId = this.generateCondition(condition, -1);

    // Generate EDGE operation (47)
    const edgeId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.EDGE} ${OPERAND_TYPE.LC} ${conditionId} ${OPERAND_TYPE.VALUE} ${duration} 0`
    );
    this.lcIndex++;

    // Generate actions
    for (const action of actions) {
      this.generateAction(action, edgeId);
    }
  }

  /**
   * Generate sticky handler
   * sticky(() => onCondition, () => offCondition, () => { actions })
   */
  generateSticky(stmt) {
    if (!stmt.args || stmt.args.length < 3) {
      this.errorHandler.addError(
        `sticky() requires exactly 3 arguments (onCondition, offCondition, action). Got ${stmt.args?.length || 0}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Extract parts using helper
    const onCondition = this.arrowHelper.extractExpression(stmt.args[0]);
    const offCondition = this.arrowHelper.extractExpression(stmt.args[1]);
    const actions = this.arrowHelper.extractBody(stmt.args[2]);

    if (!onCondition || !offCondition) {
      this.errorHandler.addError(
        'sticky() arguments 1 and 2 must be arrow functions',
        stmt,
        'invalid_args'
      );
      return;
    }

    // Generate ON condition LC
    const onConditionId = this.generateCondition(onCondition, -1);

    // Generate OFF condition LC
    const offConditionId = this.generateCondition(offCondition, -1);

    // Generate STICKY operation (13)
    const stickyId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.STICKY} ${OPERAND_TYPE.LC} ${onConditionId} ${OPERAND_TYPE.LC} ${offConditionId} 0`
    );
    this.lcIndex++;

    // Generate actions
    for (const action of actions) {
      this.generateAction(action, stickyId);
    }
  }

  /**
   * Generate delay handler
   * delay(() => condition, { duration: ms }, () => { actions })
   */
  generateDelay(stmt) {
    if (!stmt.args || stmt.args.length < 3) {
      this.errorHandler.addError(
        `delay() requires exactly 3 arguments (condition, duration, action). Got ${stmt.args?.length || 0}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Extract parts using helper
    const condition = this.arrowHelper.extractExpression(stmt.args[0]);
    const duration = this.arrowHelper.extractDuration(stmt.args[1]);
    const actions = this.arrowHelper.extractBody(stmt.args[2]);

    if (!condition) {
      this.errorHandler.addError(
        'delay() argument 1 must be an arrow function',
        stmt,
        'invalid_args'
      );
      return;
    }

    // Generate condition LC
    const conditionId = this.generateCondition(condition, -1);

    // Generate DELAY operation (48)
    const delayId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.DELAY} ${OPERAND_TYPE.LC} ${conditionId} ${OPERAND_TYPE.VALUE} ${duration} 0`
    );
    this.lcIndex++;

    // Generate actions
    for (const action of actions) {
      this.generateAction(action, delayId);
    }
  }

  /**
   * Generate timer handler
   * timer(onMs, offMs, () => { actions })
   *
   * Creates a timer that cycles: ON for onMs, OFF for offMs, repeat
   * TIMER operation (49): Operand A = ON duration (ms), Operand B = OFF duration (ms)
   */
  generateTimer(stmt) {
    if (!stmt.args || stmt.args.length < 3) {
      this.errorHandler.addError(
        `timer() requires exactly 3 arguments (onMs, offMs, action). Got ${stmt.args?.length || 0}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Extract durations (should be literals)
    const onMs = this.arrowHelper.extractValue(stmt.args[0]);
    const offMs = this.arrowHelper.extractValue(stmt.args[1]);
    const actions = this.arrowHelper.extractBody(stmt.args[2]);

    if (typeof onMs !== 'number' || typeof offMs !== 'number') {
      this.errorHandler.addError(
        `timer() durations must be numeric literals. Got: ${typeof onMs}, ${typeof offMs}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    if (onMs <= 0 || offMs <= 0) {
      this.errorHandler.addError(
        `timer() durations must be positive. Got: onMs=${onMs}ms, offMs=${offMs}ms`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Generate TIMER operation (49)
    // This is the activator - no condition needed, timer auto-toggles
    const timerId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.TIMER} ${OPERAND_TYPE.VALUE} ${onMs} ${OPERAND_TYPE.VALUE} ${offMs} 0`
    );
    this.lcIndex++;

    // Generate actions
    for (const action of actions) {
      this.generateAction(action, timerId);
    }
  }

  /**
   * Generate whenChanged handler (DELTA operation)
   * whenChanged(value, threshold, () => { actions })
   *
   * Triggers when value changes by >= threshold within 100ms
   * DELTA operation (50): Operand A = value to monitor, Operand B = threshold
   */
  generateWhenChanged(stmt) {
    if (!stmt.args || stmt.args.length < 3) {
      this.errorHandler.addError(
        `whenChanged() requires exactly 3 arguments (value, threshold, action). Got ${stmt.args?.length || 0}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Extract value to monitor (should be a flight parameter or gvar)
    const valueExpr = stmt.args[0];
    const threshold = this.arrowHelper.extractValue(stmt.args[1]);
    const actions = this.arrowHelper.extractBody(stmt.args[2]);

    if (typeof threshold !== 'number') {
      this.errorHandler.addError(
        `whenChanged() threshold must be a numeric literal. Got: ${typeof threshold}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    if (threshold <= 0) {
      this.errorHandler.addError(
        `whenChanged() threshold must be positive. Got: ${threshold}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Get the operand for the value to monitor
    // This could be flight.altitude, gvar[0], etc.
    const valueIdentifier = this.arrowHelper.extractIdentifier(valueExpr);
    const valueOperand = this.getOperand(valueIdentifier);

    if (!valueOperand) {
      this.errorHandler.addError(
        `whenChanged() invalid value: ${valueIdentifier}`,
        stmt,
        'invalid_args'
      );
      return;
    }

    // Generate DELTA operation (50)
    // This is the activator - returns true when value changes by >= threshold
    const deltaId = this.lcIndex;
    this.commands.push(
      `logic ${this.lcIndex} 1 -1 ${OPERATION.DELTA} ${valueOperand.type} ${valueOperand.value} ${OPERAND_TYPE.VALUE} ${threshold} 0`
    );
    this.lcIndex++;

    // Generate actions
    for (const action of actions) {
      this.generateAction(action, deltaId);
    }
  }

  /**
   * Generate condition logic condition
   * @returns {number} The LC index of the final condition result
   */
  generateCondition(condition, activatorId) {
    if (!condition) return this.lcIndex;

    switch (condition.type) {
      case 'BinaryExpression': {
        const left = this.getOperand(condition.left);
        const right = this.getOperand(condition.right);
        const op = this.getOperation(condition.operator);

        const resultIndex = this.lcIndex;
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${op} ${left.type} ${left.value} ${right.type} ${right.value} 0`
        );
        this.lcIndex++;
        return resultIndex;
      }

      case 'LogicalExpression': {
        // Generate left condition
        const leftId = this.generateCondition(condition.left, activatorId);

        // Generate right condition
        const rightId = this.generateCondition(condition.right, activatorId);

        // Combine with logical operator
        const op = condition.operator === '&&' ? OPERATION.AND : OPERATION.OR;
        const resultIndex = this.lcIndex;
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${op} ${OPERAND_TYPE.LC} ${leftId} ${OPERAND_TYPE.LC} ${rightId} 0`
        );
        this.lcIndex++;
        return resultIndex;
      }

      case 'UnaryExpression': {
        // Generate argument
        const argId = this.generateCondition(condition.argument, activatorId);

        // Apply NOT
        const resultIndex = this.lcIndex;
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.NOT} ${OPERAND_TYPE.LC} ${argId} ${OPERAND_TYPE.VALUE} 0 0`
        );
        this.lcIndex++;
        return resultIndex;
      }

      case 'MemberExpression': {
        // Boolean property access (e.g., flight.mode.failsafe)
        const operand = this.getOperand(condition.value);

        // Check if true
        const resultIndex = this.lcIndex;
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.EQUAL} ${operand.type} ${operand.value} ${OPERAND_TYPE.VALUE} 1 0`
        );
        this.lcIndex++;
        return resultIndex;
      }

      case 'Literal': {
        // Literal true/false
        const resultIndex = this.lcIndex;
        if (condition.value === true) {
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.TRUE} ${OPERAND_TYPE.VALUE} 0 ${OPERAND_TYPE.VALUE} 0 0`
          );
        } else {
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.NOT} ${OPERAND_TYPE.VALUE} 1 ${OPERAND_TYPE.VALUE} 0 0`
          );
        }
        this.lcIndex++;
        return resultIndex;
      }

      default:
        this.errorHandler.addError(
          `Unsupported condition type: ${condition.type}. Use comparison operators (>, <, ===, etc.) and logical operators (&&, ||, !)`,
          condition,
          'unsupported_condition'
        );
        return this.lcIndex;
    }
  }

  /**
   * Generate action logic condition
   */
  generateAction(action, activatorId) {
    if (!action || action.type !== 'Assignment') return;

    const target = action.target;
    const value = action.value;

    // Handle gvar assignment
    if (target.startsWith('gvar[')) {
      const index = parseInt(target.match(/\d+/)[0]);

      if (action.operation) {
        // Arithmetic: gvar[0] = gvar[0] + 10
        const left = this.getOperand(action.left);
        const right = this.getOperand(action.right);

        // Optimize gvar[n] = gvar[n] +/- value to use GVAR_INC/GVAR_DEC
        const isLeftSameGvar = left.type === OPERAND_TYPE.GVAR && left.value === index;
        const isRightSameGvar = right.type === OPERAND_TYPE.GVAR && right.value === index;

        if (action.operation === '+' && isLeftSameGvar) {
          // gvar[n] = gvar[n] + value → GVAR_INC
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.GVAR_INC} ${OPERAND_TYPE.VALUE} ${index} ${right.type} ${right.value} 0`
          );
          this.lcIndex++;
          return;
        }

        if (action.operation === '-' && isLeftSameGvar) {
          // gvar[n] = gvar[n] - value → GVAR_DEC
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.GVAR_DEC} ${OPERAND_TYPE.VALUE} ${index} ${right.type} ${right.value} 0`
          );
          this.lcIndex++;
          return;
        }

        if (action.operation === '+' && isRightSameGvar) {
          // gvar[n] = value + gvar[n] → GVAR_INC (addition is commutative)
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.GVAR_INC} ${OPERAND_TYPE.VALUE} ${index} ${left.type} ${left.value} 0`
          );
          this.lcIndex++;
          return;
        }

        // Fall back to compute + set for other operations
        const op = this.getArithmeticOperation(action.operation);

        // First compute the result
        const resultId = this.lcIndex;
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${op} ${left.type} ${left.value} ${right.type} ${right.value} 0`
        );
        this.lcIndex++;

        // Then assign to gvar
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.GVAR_SET} ${OPERAND_TYPE.VALUE} ${index} ${OPERAND_TYPE.LC} ${resultId} 0`
        );
        this.lcIndex++;
      } else {
        // Simple assignment: gvar[0] = 100
        const valueOperand = this.getOperand(value);
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.GVAR_SET} ${OPERAND_TYPE.VALUE} ${index} ${valueOperand.type} ${valueOperand.value} 0`
        );
        this.lcIndex++;
      }
      return;
    }

    // Handle rc channel assignment: rc[5] = 1500
    // This is an alias for override.rcChannel(5, 1500)
    if (target.startsWith('rc[')) {
      const channelMatch = target.match(/rc\[(\d+)\]/);
      if (!channelMatch) {
        this.errorHandler.addError(
          `Invalid RC channel syntax: '${target}'. Expected format: rc[0] through rc[17]`,
          null,
          'invalid_rc_syntax'
        );
        return;
      }

      const channel = parseInt(channelMatch[1]);

      // Validate channel range
      if (channel < 0 || channel > 17) {
        this.errorHandler.addError(
          `RC channel ${channel} out of range. INAV supports rc[0] through rc[17]`,
          null,
          'rc_out_of_range'
        );
        return;
      }

      const valueOperand = this.getOperand(value);

      // Generate RC_CHANNEL_OVERRIDE operation (38)
      // operandA = channel number, operandB = value
      this.commands.push(
        `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.RC_CHANNEL_OVERRIDE} ${OPERAND_TYPE.VALUE} ${channel} ${valueOperand.type} ${valueOperand.value} 0`
      );
      this.lcIndex++;
      return;
    }

    if (target.startsWith('override.')) {
      const operation = this.getOverrideOperation(target);
      const valueOperand = this.getOperand(value);

      this.commands.push(
        `logic ${this.lcIndex} 1 ${activatorId} ${operation} ${valueOperand.type} ${valueOperand.value} 0 0 0`
      );
      this.lcIndex++;
      return;
    }

    // Handle variable assignment (var variables resolve to gvar[N])
    if (this.variableHandler && this.variableHandler.isVariable(target)) {
      const resolution = this.variableHandler.resolveVariable(target);

      if (resolution && resolution.type === 'var_gvar') {
        // Resolve to gvar[N] and generate gvar assignment
        const gvarRef = resolution.gvarRef;
        const index = parseInt(gvarRef.match(/\d+/)[0]);

        if (action.operation) {
          // Arithmetic operation
          const left = this.getOperand(action.left);
          const right = this.getOperand(action.right);

          const op = action.operation === '+' ? OPERATION.ADD :
                     action.operation === '-' ? OPERATION.SUB :
                     action.operation === '*' ? OPERATION.MUL :
                     action.operation === '/' ? OPERATION.DIV : null;

          if (!op) {
            this.errorHandler.addError(`Unsupported operation: ${action.operation}`, null, 'unsupported_operation');
            return;
          }

          const resultId = this.lcIndex;
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${op} ${left.type} ${left.value} ${right.type} ${right.value} 0`
          );
          this.lcIndex++;

          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.GVAR_SET} ${OPERAND_TYPE.VALUE} ${index} ${OPERAND_TYPE.LC} ${resultId} 0`
          );
          this.lcIndex++;
        } else {
          // Simple assignment
          const valueOperand = this.getOperand(value);
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.GVAR_SET} ${OPERAND_TYPE.VALUE} ${index} ${valueOperand.type} ${valueOperand.value} 0`
          );
          this.lcIndex++;
        }
        return;
      }
    }

    this.errorHandler.addError(
      `Cannot assign to '${target}'. Only gvar[0-7], rc[0-17], and override.* are writable`,
      null,
      'invalid_assignment_target'
    );
  }

  /**
   * Get operand from value
   */
  getOperand(value, activatorId = -1) {
    if (typeof value === 'number') {
      return { type: OPERAND_TYPE.VALUE, value };
    }

    if (typeof value === 'boolean') {
      return { type: OPERAND_TYPE.VALUE, value: value ? 1 : 0 };
    }

    if (typeof value === 'string') {
      // Check if it's a variable reference
      if (this.variableHandler && this.variableHandler.isVariable(value)) {
        const resolution = this.variableHandler.resolveVariable(value);

        if (resolution.type === 'let_expression') {
          // Inline substitute the expression AST
          return this.getOperand(resolution.ast, activatorId);
        } else if (resolution.type === 'var_gvar') {
          // Replace with gvar reference and continue
          value = resolution.gvarRef;
        }
      }

      // Check for gvar
      if (value.startsWith('gvar[')) {
        const index = parseInt(value.match(/\d+/)[0]);
        return { type: OPERAND_TYPE.GVAR, value: index };
      }

      // Check for rc channel
      if (value.startsWith('rc[')) {
        const index = parseInt(value.match(/\d+/)[0]);
        return { type: OPERAND_TYPE.RC_CHANNEL, value: index };
      }

      // Check in operand mapping
      if (this.operandMapping[value]) {
        return this.operandMapping[value];
      }

      this.errorHandler.addError(
        `Unknown operand '${value}'. Available: flight.*, rc.*, gvar[0-7], waypoint.*, pid.*`,
        null,
        'unknown_operand'
      );
      return { type: OPERAND_TYPE.VALUE, value: 0 }; // Return dummy value to continue collecting errors
    }

    // Handle expression objects (CallExpression, BinaryExpression, etc.)
    if (typeof value === 'object' && value !== null && value.type) {
      return this.generateExpression(value, activatorId);
    }

    return { type: OPERAND_TYPE.VALUE, value: 0 };
  }

  /**
   * Generate an expression and return operand reference to result
   * Handles Math.abs(), arithmetic operations, etc.
   */
  generateExpression(expr, activatorId) {
    if (!expr || !expr.type) {
      return { type: OPERAND_TYPE.VALUE, value: 0 };
    }

    switch (expr.type) {
      case 'CallExpression': {
        // Handle Math.abs(x)
        if (expr.callee && expr.callee.type === 'MemberExpression' &&
            expr.callee.object && expr.callee.object.name === 'Math' &&
            expr.callee.property && expr.callee.property.name === 'abs') {

          if (!expr.arguments || expr.arguments.length !== 1) {
            this.errorHandler.addError(
              `Math.abs() requires exactly 1 argument. Got ${expr.arguments?.length || 0}`,
              expr,
              'invalid_args'
            );
            return { type: OPERAND_TYPE.VALUE, value: 0 };
          }

          // Get the argument operand (recursively handle nested expressions)
          const arg = this.getOperand(this.arrowHelper.extractIdentifier(expr.arguments[0]) || expr.arguments[0], activatorId);

          // Compute abs using: abs(x) = max(x, 0 - x)
          // First: compute 0 - x
          const negId = this.lcIndex;
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.SUB} ${OPERAND_TYPE.VALUE} 0 ${arg.type} ${arg.value} 0`
          );
          this.lcIndex++;

          // Then: compute max(x, -x)
          const absId = this.lcIndex;
          this.commands.push(
            `logic ${this.lcIndex} 1 ${activatorId} ${OPERATION.MAX} ${arg.type} ${arg.value} ${OPERAND_TYPE.LC} ${negId} 0`
          );
          this.lcIndex++;

          return { type: OPERAND_TYPE.LC, value: absId };
        }

        const funcName = expr.callee?.property?.name ||
                        (expr.callee?.name || 'unknown');
        this.errorHandler.addError(
          `Unsupported function: ${funcName}(). Supported: edge(), sticky(), delay(), timer(), whenChanged(), Math.abs()`,
          expr,
          'unsupported_function'
        );
        return { type: OPERAND_TYPE.VALUE, value: 0 };
      }

      case 'BinaryExpression': {
        // Handle arithmetic: a + b, a - b, etc.
        const left = this.getOperand(this.arrowHelper.extractIdentifier(expr.left) || expr.left, activatorId);
        const right = this.getOperand(this.arrowHelper.extractIdentifier(expr.right) || expr.right, activatorId);
        const op = this.getArithmeticOperation(expr.operator);

        const resultId = this.lcIndex;
        this.commands.push(
          `logic ${this.lcIndex} 1 ${activatorId} ${op} ${left.type} ${left.value} ${right.type} ${right.value} 0`
        );
        this.lcIndex++;

        return { type: OPERAND_TYPE.LC, value: resultId };
      }

      default:
        this.errorHandler.addError(
          `Unsupported expression type: ${expr.type}. Use arithmetic operators (+, -, *, /) or supported functions`,
          expr,
          'unsupported_expression'
        );
        return { type: OPERAND_TYPE.VALUE, value: 0 };
    }
  }

  /**
   * Get operation from operator
   */
  getOperation(operator) {
    const ops = {
      '===': OPERATION.EQUAL,
      '==': OPERATION.EQUAL,
      '>': OPERATION.GREATER_THAN,
      '<': OPERATION.LOWER_THAN,
      '>=': OPERATION.GREATER_THAN, // Note: INAV doesn't have >=, use >
      '<=': OPERATION.LOWER_THAN,   // Note: INAV doesn't have <=, use <
      '!==': OPERATION.NOT,
      '!=': OPERATION.NOT
    };

    return ops[operator] || OPERATION.EQUAL;
  }

  /**
   * Get arithmetic operation
   */
  getArithmeticOperation(operator) {
    const ops = {
      '+': OPERATION.ADD,
      '-': OPERATION.SUB,
      '*': OPERATION.MUL,
      '/': OPERATION.DIV,
      '%': OPERATION.MOD
    };

    return ops[operator] || OPERATION.ADD;
  }
    /**
     * Get override operation for target
     */
    getOverrideOperation(target) {
      const operations = {
        'override.throttleScale': OPERATION.OVERRIDE_THROTTLE_SCALE,
        'override.throttle': OPERATION.OVERRIDE_THROTTLE,
        'override.vtx.power': OPERATION.SET_VTX_POWER_LEVEL,
        'override.vtx.band': OPERATION.SET_VTX_BAND,
        'override.vtx.channel': OPERATION.SET_VTX_CHANNEL,
        'override.armSafety': OPERATION.OVERRIDE_ARMING_SAFETY
      };

      const operation = operations[target];
      if (!operation) {
        throw new Error(`Unknown override target: ${target}`);
      }

      return operation;
    }
}

export { INAVCodeGenerator };
