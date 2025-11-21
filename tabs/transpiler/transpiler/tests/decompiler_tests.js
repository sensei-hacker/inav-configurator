/**
 * Decompiler Test Cases
 * 
 * Location: tabs/programming/transpiler/transpiler/tests/decompiler.test.js
 */

'use strict';

const { Decompiler } = require('../decompiler.js');

describe('Decompiler', () => {
  let decompiler;
  
  beforeEach(() => {
    decompiler = new Decompiler();
  });
  
  describe('Basic Decompilation', () => {
    test('should handle empty logic conditions', () => {
      const result = decompiler.decompile([]);
      
      expect(result.success).toBe(true);
      expect(result.code).toContain('No logic conditions found');
      expect(result.warnings).toHaveLength(1);
    });
    
    test('should handle null input', () => {
      const result = decompiler.decompile(null);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid logic conditions');
    });
    
    test('should handle disabled conditions', () => {
      const conditions = [
        { index: 0, enabled: 0, operation: 0 }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.success).toBe(true);
      expect(result.warnings).toContain('All logic conditions are disabled');
    });
  });
  
  describe('on.arm Handler', () => {
    test('should decompile on.arm with delay', () => {
      const conditions = [
        // Activator: armTimer > 1000
        {
          index: 0,
          enabled: 1,
          activatorId: -1,
          operation: 2, // GREATER_THAN
          operandAType: 2, // FLIGHT
          operandAValue: 0, // armTimer
          operandBType: 0, // VALUE
          operandBValue: 1000
        },
        // Action: gvar[0] = 100
        {
          index: 1,
          enabled: 1,
          activatorId: 0,
          operation: 19, // SET_GVAR
          operandAType: 3, // GVAR
          operandAValue: 0,
          operandBType: 0, // VALUE
          operandBValue: 100
        }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.success).toBe(true);
      expect(result.code).toContain('on.arm({ delay: 1 }');
      expect(result.code).toContain('gvar[0] = 100');
    });
  });
  
  describe('when Handler', () => {
    test('should decompile simple when condition', () => {
      const conditions = [
        // Condition: flight.homeDistance > 100
        {
          index: 0,
          enabled: 1,
          activatorId: -1,
          operation: 2, // GREATER_THAN
          operandAType: 2, // FLIGHT
          operandAValue: 1, // homeDistance
          operandBType: 0, // VALUE
          operandBValue: 100
        },
        // Action: override.vtx.power = 3
        {
          index: 1,
          enabled: 1,
          activatorId: 0,
          operation: 27, // OVERRIDE_VTX_POWER
          operandAType: 0,
          operandAValue: 0,
          operandBType: 0, // VALUE
          operandBValue: 3
        }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.success).toBe(true);
      expect(result.code).toContain('when(() => flight.homeDistance > 100');
      expect(result.code).toContain('override.vtx.power = 3');
    });
    
    test('should decompile when with multiple actions', () => {
      const conditions = [
        // Condition: flight.cellVoltage < 350
        {
          index: 0,
          enabled: 1,
          activatorId: -1,
          operation: 3, // LOWER_THAN
          operandAType: 2, // FLIGHT
          operandAValue: 5, // cellVoltage
          operandBType: 0, // VALUE
          operandBValue: 350
        },
        // Action 1: override.throttleScale = 50
        {
          index: 1,
          enabled: 1,
          activatorId: 0,
          operation: 25, // OVERRIDE_THROTTLE_SCALE
          operandAType: 0,
          operandAValue: 0,
          operandBType: 0,
          operandBValue: 50
        },
        // Action 2: gvar[0] = 1
        {
          index: 2,
          enabled: 1,
          activatorId: 0,
          operation: 19, // SET_GVAR
          operandAType: 3,
          operandAValue: 0,
          operandBType: 0,
          operandBValue: 1
        }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.success).toBe(true);
      expect(result.code).toContain('when(() => flight.cellVoltage < 350');
      expect(result.code).toContain('override.throttleScale = 50');
      expect(result.code).toContain('gvar[0] = 1');
    });
  });
  
  describe('Operand Decompilation', () => {
    test('should decompile flight parameters', () => {
      const param = decompiler.decompileOperand(2, 1); // FLIGHT, homeDistance
      expect(param).toBe('flight.homeDistance');
    });
    
    test('should decompile gvar references', () => {
      const param = decompiler.decompileOperand(3, 0); // GVAR[0]
      expect(param).toBe('gvar[0]');
    });
    
    test('should decompile literal values', () => {
      const param = decompiler.decompileOperand(0, 100); // VALUE, 100
      expect(param).toBe('100');
    });
    
    test('should warn on unknown flight parameter', () => {
      decompiler.warnings = [];
      const param = decompiler.decompileOperand(2, 999); // Unknown param
      
      expect(param).toContain('unknown');
      expect(decompiler.warnings.length).toBeGreaterThan(0);
    });
  });
  
  describe('Condition Decompilation', () => {
    test('should decompile comparison operators', () => {
      const conditions = [
        { operation: 1, operandAType: 2, operandAValue: 1, operandBType: 0, operandBValue: 100 }, // EQUAL
        { operation: 2, operandAType: 2, operandAValue: 1, operandBType: 0, operandBValue: 100 }, // GREATER_THAN
        { operation: 3, operandAType: 2, operandAValue: 1, operandBType: 0, operandBValue: 100 }  // LOWER_THAN
      ];
      
      expect(decompiler.decompileCondition(conditions[0])).toContain('===');
      expect(decompiler.decompileCondition(conditions[1])).toContain('>');
      expect(decompiler.decompileCondition(conditions[2])).toContain('<');
    });
    
    test('should decompile RC channel states', () => {
      const lc = {
        operation: 6, // HIGH
        operandAType: 0,
        operandAValue: 5,
        operandBType: 0,
        operandBValue: 0
      };
      
      const condition = decompiler.decompileCondition(lc);
      expect(condition).toContain('.high');
    });
    
    test('should decompile logical operators', () => {
      const andLC = {
        operation: 7, // AND
        operandAType: 0,
        operandAValue: 1,
        operandBType: 0,
        operandBValue: 1
      };
      
      const condition = decompiler.decompileCondition(andLC);
      expect(condition).toContain('&&');
    });
  });
  
  describe('Action Decompilation', () => {
    test('should decompile gvar operations', () => {
      const setGvar = {
        operation: 19, // SET_GVAR
        operandAType: 3,
        operandAValue: 0,
        operandBType: 0,
        operandBValue: 100
      };
      
      const action = decompiler.decompileAction(setGvar);
      expect(action).toBe('gvar[0] = 100');
    });
    
    test('should decompile increment/decrement', () => {
      const incGvar = {
        operation: 20, // INC_GVAR
        operandAType: 3,
        operandAValue: 0,
        operandBType: 0,
        operandBValue: 1
      };
      
      const action = decompiler.decompileAction(incGvar);
      expect(action).toContain('gvar[0] = gvar[0] + 1');
    });
    
    test('should decompile override operations', () => {
      const vtxPower = {
        operation: 27, // OVERRIDE_VTX_POWER
        operandAType: 0,
        operandAValue: 0,
        operandBType: 0,
        operandBValue: 3
      };
      
      const action = decompiler.decompileAction(vtxPower);
      expect(action).toBe('override.vtx.power = 3');
    });
  });
  
  describe('Complex Scenarios', () => {
    test('should decompile multiple independent when statements', () => {
      const conditions = [
        // First when: homeDistance > 100
        { index: 0, enabled: 1, activatorId: -1, operation: 2, 
          operandAType: 2, operandAValue: 1, operandBType: 0, operandBValue: 100 },
        { index: 1, enabled: 1, activatorId: 0, operation: 27, 
          operandAType: 0, operandAValue: 0, operandBType: 0, operandBValue: 3 },
        
        // Second when: cellVoltage < 350
        { index: 2, enabled: 1, activatorId: -1, operation: 3, 
          operandAType: 2, operandAValue: 5, operandBType: 0, operandBValue: 350 },
        { index: 3, enabled: 1, activatorId: 2, operation: 25, 
          operandAType: 0, operandAValue: 0, operandBType: 0, operandBValue: 50 }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.success).toBe(true);
      expect(result.stats.groups).toBe(2);
      expect(result.code).toContain('flight.homeDistance > 100');
      expect(result.code).toContain('flight.cellVoltage < 350');
    });
  });
  
  describe('Edge Cases', () => {
    test('should handle conditions with no actions', () => {
      const conditions = [
        { index: 0, enabled: 1, activatorId: -1, operation: 2, 
          operandAType: 2, operandAValue: 1, operandBType: 0, operandBValue: 100 }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.success).toBe(true);
      // Should still generate code, just with empty body
    });
    
    test('should skip conditions with invalid structure', () => {
      const conditions = [
        { index: 0, enabled: 1 }, // Missing required fields
        { index: 1, enabled: 1, activatorId: -1, operation: 2, 
          operandAType: 2, operandAValue: 1, operandBType: 0, operandBValue: 100 }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.success).toBe(true);
      // Should handle gracefully
    });
  });
  
  describe('Warning Generation', () => {
    test('should warn about unsupported features', () => {
      decompiler.warnings = [];
      
      // Use an unsupported operand type
      decompiler.decompileOperand(4, 0); // PID
      
      expect(decompiler.warnings.length).toBeGreaterThan(0);
      expect(decompiler.warnings[0]).toContain('PID');
    });
    
    test('should include warnings in output', () => {
      const conditions = [
        {
          index: 0,
          enabled: 1,
          activatorId: -1,
          operation: 2,
          operandAType: 4, // PID (unsupported)
          operandAValue: 0,
          operandBType: 0,
          operandBValue: 100
        }
      ];
      
      const result = decompiler.decompile(conditions);
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.code).toContain('// Decompilation Warnings:');
    });
  });
});

/**
 * Integration test examples
 */
describe('Decompiler Integration', () => {
  test('should handle real-world VTX power example', () => {
    const decompiler = new Decompiler();
    
    // Simulate: when(flight.homeDistance > 100) { override.vtx.power = 3; }
    const conditions = [
      {
        index: 0,
        enabled: 1,
        activatorId: -1,
        operation: 2, // >
        operandAType: 2, // FLIGHT
        operandAValue: 1, // homeDistance
        operandBType: 0, // VALUE
        operandBValue: 100
      },
      {
        index: 1,
        enabled: 1,
        activatorId: 0,
        operation: 27, // OVERRIDE_VTX_POWER
        operandAType: 0,
        operandAValue: 0,
        operandBType: 0,
        operandBValue: 3
      }
    ];
    
    const result = decompiler.decompile(conditions);
    
    expect(result.success).toBe(true);
    expect(result.code).toContain('when');
    expect(result.code).toContain('flight.homeDistance > 100');
    expect(result.code).toContain('override.vtx.power = 3');
  });
});