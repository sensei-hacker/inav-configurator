/**
 * INAV Logic Condition Constants
 * 
 * Location: js/transpiler/transpiler/inav_constants.js
 * 
 * These constants MUST stay in sync with INAV firmware.
 * Source: https://github.com/iNavFlight/inav/blob/master/src/main/programming/logic_condition.h
 * 
 * Updated to match INAV 8.0 (2024)
 */

'use strict';

/**
 * Logic condition operand types
 * Defines what kind of value an operand represents
 */
const OPERAND_TYPE = {
  VALUE: 0,              // Literal numeric value
  RC_CHANNEL: 1,         // RC channel (1-18)
  FLIGHT: 2,             // Flight controller parameter
  FLIGHT_MODE: 3,        // Flight mode boolean
  GET_LC_VALUE: 4,       // Result from another logic condition (was LC)
  GVAR: 5,               // Global variable (read/write)
  PID: 6,                // Programming PID controller value
  WAYPOINTS: 7           // Waypoint parameter (was WAYPOINT: 5)
};

/**
 * Logic condition operations
 * Defines what operation to perform
 */
const OPERATION = {
  // Conditionals (return boolean)
  TRUE: 0,                              // Always true
  EQUAL: 1,                             // a === b
  GREATER_THAN: 2,                      // a > b
  LOWER_THAN: 3,                        // a < b
  LOW: 4,                               // RC channel is low (< 1333)
  MID: 5,                               // RC channel is mid (1333-1666)
  HIGH: 6,                              // RC channel is high (> 1666)
  
  // Logical operators
  AND: 7,                               // a && b
  OR: 8,                                // a || b
  XOR: 9,                               // a ^ b
  NAND: 10,                             // !(a && b)
  NOR: 11,                              // !(a || b)
  NOT: 12,                              // !a
  STICKY: 13,                           // Sticky condition
  
  // Arithmetic (return numeric)
  ADD: 14,                              // a + b
  SUB: 15,                              // a - b
  MUL: 16,                              // a * b
  DIV: 17,                              // a / b
  
  // Global variable operations
  GVAR_SET: 18,                         // gvar[a] = b (was SET_GVAR: 19)
  GVAR_INC: 19,                         // gvar[a] += b (was INC_GVAR: 20)
  GVAR_DEC: 20,                         // gvar[a] -= b (was DEC_GVAR: 21)
  
  // Port operations
  PORT_SET: 21,                         // I2C IO expander port set
  
  // Override operations
  OVERRIDE_ARMING_SAFETY: 22,           // (was 23)
  OVERRIDE_THROTTLE_SCALE: 23,          // (was 25)
  SWAP_ROLL_YAW: 24,                    // Swap roll and yaw
  SET_VTX_POWER_LEVEL: 25,              // VTX power (was OVERRIDE_VTX_POWER: 27)
  INVERT_ROLL: 26,                      // Invert roll axis
  INVERT_PITCH: 27,                     // Invert pitch axis
  INVERT_YAW: 28,                       // Invert yaw axis
  OVERRIDE_THROTTLE: 29,                // (was 26)
  SET_VTX_BAND: 30,                     // VTX band (was OVERRIDE_VTX_BAND: 28)
  SET_VTX_CHANNEL: 31,                  // VTX channel (was OVERRIDE_VTX_CHANNEL: 29)
  SET_OSD_LAYOUT: 32,                   // OSD layout
  
  // Math functions
  SIN: 33,                              // Math.sin(a) in degrees (was 35)
  COS: 34,                              // Math.cos(a) in degrees (was 36)
  TAN: 35,                              // Math.tan(a) in degrees (was 37)
  MAP_INPUT: 36,                        // Map input value (was 38)
  MAP_OUTPUT: 37,                       // Map output value (was 39)
  RC_CHANNEL_OVERRIDE: 38,              // Override RC channel (was 40)
  SET_HEADING_TARGET: 39,               // Set heading hold target
  MODULUS: 40,                          // a % b (was MOD: 18)
  LOITER_OVERRIDE: 41,                  // Override loiter radius
  SET_PROFILE: 42,                      // Change PID profile
  MIN: 43,                              // Math.min(a, b) (was 30)
  MAX: 44,                              // Math.max(a, b) (was 31)
  FLIGHT_AXIS_ANGLE_OVERRIDE: 45,       // Override flight axis angle
  FLIGHT_AXIS_RATE_OVERRIDE: 46,        // Override flight axis rate
  EDGE: 47,                             // Edge detection
  DELAY: 48,                            // Delay condition
  TIMER: 49,                            // Timer
  DELTA: 50,                            // Delta/change detection
  APPROX_EQUAL: 51,                     // Approximately equal
  LED_PIN_PWM: 52,                      // LED pin PWM
  DISABLE_GPS_FIX: 53,                  // Disable GPS fix estimation
  RESET_MAG_CALIBRATION: 54,            // Reset magnetometer calibration
  SET_GIMBAL_SENSITIVITY: 55,           // Set gimbal sensitivity
  OVERRIDE_MIN_GROUND_SPEED: 56         // Override minimum ground speed
};

/**
 * Flight parameters (operand value for OPERAND_TYPE.FLIGHT)
 * Maps to flight controller telemetry
 */
const FLIGHT_PARAM = {
  ARM_TIMER: 0,                         // Time since arming (s)
  HOME_DISTANCE: 1,                     // Distance to home (m)
  TRIP_DISTANCE: 2,                     // Total trip distance (m)
  RSSI: 3,                              // RSSI value (0-99)
  VBAT: 4,                              // Battery voltage (V/100)
  CELL_VOLTAGE: 5,                      // Cell voltage (V/10)
  CURRENT: 6,                           // Current draw (A/100)
  MAH_DRAWN: 7,                         // mAh consumed
  GPS_SATS: 8,                          // GPS satellite count
  GROUND_SPEED: 9,                      // Ground speed (cm/s)
  SPEED_3D: 10,                         // 3D speed (cm/s)
  AIR_SPEED: 11,                        // Air speed (cm/s)
  ALTITUDE: 12,                         // Altitude (cm)
  VERTICAL_SPEED: 13,                   // Vertical speed (cm/s)
  THROTTLE_POS: 14,                     // Throttle position (%)
  ROLL: 15,                             // Roll angle (degrees)
  PITCH: 16,                            // Pitch angle (degrees)
  IS_ARMED: 17,                         // Armed state (0/1)
  IS_AUTOLAUNCH: 18,                    // Autolaunch active (0/1)
  IS_ALTITUDE_CONTROL: 19,              // Altitude control active (0/1)
  IS_POSITION_CONTROL: 20,              // Position control active (0/1)
  IS_EMERGENCY_LANDING: 21,             // Emergency landing (0/1)
  IS_RTH: 22,                           // RTH active (0/1)
  IS_LANDING: 23,                       // Landing active (0/1)
  IS_FAILSAFE: 24,                      // Failsafe active (0/1)
  STABILIZED_ROLL: 25,                  // Stabilized roll
  STABILIZED_PITCH: 26,                 // Stabilized pitch
  STABILIZED_YAW: 27,                   // Stabilized yaw
  HOME_DISTANCE_3D: 28,                 // 3D distance to home (m)
  CRSF_LQ_UPLINK: 29,                   // CRSF uplink LQ
  CRSF_SNR: 30,                         // CRSF SNR (was 39 - typo in header)
  GPS_VALID: 31,                        // GPS fix valid (0/1)
  LOITER_RADIUS: 32,                    // Loiter radius
  ACTIVE_PROFILE: 33,                   // Active PID profile
  BATT_CELLS: 34,                       // Battery cell count
  AGL_STATUS: 35,                       // AGL status
  AGL: 36,                              // Above ground level
  RANGEFINDER_RAW: 37,                  // Rangefinder raw value
  ACTIVE_MIXER_PROFILE: 38,             // Active mixer profile
  MIXER_TRANSITION_ACTIVE: 39,          // Mixer transition active (0/1)
  YAW: 40,                              // Yaw/heading (degrees)
  FW_LAND_STATE: 41,                    // Fixed wing landing state
  BATT_PROFILE: 42,                     // Active battery profile
  FLOWN_LOITER_RADIUS: 43,              // Flown loiter radius
  CRSF_LQ_DOWNLINK: 44,                 // CRSF downlink LQ
  CRSF_RSSI_DBM: 45,                    // CRSF uplink RSSI (dBm)
  MIN_GROUND_SPEED: 46,                 // Minimum ground speed (m/s)
  HORIZONTAL_WIND_SPEED: 47,            // Horizontal wind speed (cm/s)
  WIND_DIRECTION: 48,                   // Wind direction (degrees)
  RELATIVE_WIND_OFFSET: 49              // Relative wind offset (degrees)
};

/**
 * Flight modes (operand value for OPERAND_TYPE.FLIGHT_MODE)
 */
const FLIGHT_MODE = {
  FAILSAFE: 0,
  MANUAL: 1,
  RTH: 2,
  POSHOLD: 3,
  CRUISE: 4,
  ALTHOLD: 5,
  ANGLE: 6,
  HORIZON: 7,
  AIR: 8,
  USER1: 9,
  USER2: 10,
  COURSE_HOLD: 11,
  USER3: 12,
  USER4: 13,
  ACRO: 14,
  WAYPOINT_MISSION: 15,
  ANGLEHOLD: 16
};

/**
 * RC channel operations
 * For LOW, MID, HIGH operations on RC channels
 */
const RC_CHANNEL = {
  MIN_CHANNEL: 1,                       // Channels are 1-18 (not 0-17!)
  MAX_CHANNEL: 18
};

/**
 * Global variable configuration
 */
const GVAR_CONFIG = {
  COUNT: 8,                             // Number of global variables (0-7)
  MIN_VALUE: -1000000,                  // Minimum value
  MAX_VALUE: 1000000                    // Maximum value
};

/**
 * VTX configuration
 */
const VTX = {
  POWER: {
    MIN: 0,
    MAX: 4
  },
  BAND: {
    MIN: 0,
    MAX: 5
  },
  CHANNEL: {
    MIN: 0,
    MAX: 8
  }
};

/**
 * Human-readable names for flight parameters
 * Used for decompilation
 */
const FLIGHT_PARAM_NAMES = {
  [FLIGHT_PARAM.ARM_TIMER]: 'armTimer',
  [FLIGHT_PARAM.HOME_DISTANCE]: 'homeDistance',
  [FLIGHT_PARAM.TRIP_DISTANCE]: 'tripDistance',
  [FLIGHT_PARAM.RSSI]: 'rssi',
  [FLIGHT_PARAM.VBAT]: 'vbat',
  [FLIGHT_PARAM.CELL_VOLTAGE]: 'cellVoltage',
  [FLIGHT_PARAM.CURRENT]: 'current',
  [FLIGHT_PARAM.MAH_DRAWN]: 'mahDrawn',
  [FLIGHT_PARAM.GPS_SATS]: 'gpsNumSat',
  [FLIGHT_PARAM.GROUND_SPEED]: 'groundSpeed',
  [FLIGHT_PARAM.SPEED_3D]: 'speed3d',
  [FLIGHT_PARAM.AIR_SPEED]: 'airSpeed',
  [FLIGHT_PARAM.ALTITUDE]: 'altitude',
  [FLIGHT_PARAM.VERTICAL_SPEED]: 'verticalSpeed',
  [FLIGHT_PARAM.THROTTLE_POS]: 'throttlePos',
  [FLIGHT_PARAM.ROLL]: 'roll',
  [FLIGHT_PARAM.PITCH]: 'pitch',
  [FLIGHT_PARAM.IS_ARMED]: 'isArmed',
  [FLIGHT_PARAM.IS_AUTOLAUNCH]: 'isAutolaunch',
  [FLIGHT_PARAM.IS_ALTITUDE_CONTROL]: 'isAltitudeControl',
  [FLIGHT_PARAM.IS_POSITION_CONTROL]: 'isPositionControl',
  [FLIGHT_PARAM.IS_EMERGENCY_LANDING]: 'isEmergencyLanding',
  [FLIGHT_PARAM.IS_RTH]: 'isRth',
  [FLIGHT_PARAM.IS_LANDING]: 'isLanding',
  [FLIGHT_PARAM.IS_FAILSAFE]: 'isFailsafe',
  [FLIGHT_PARAM.STABILIZED_ROLL]: 'stabilizedRoll',
  [FLIGHT_PARAM.STABILIZED_PITCH]: 'stabilizedPitch',
  [FLIGHT_PARAM.STABILIZED_YAW]: 'stabilizedYaw',
  [FLIGHT_PARAM.HOME_DISTANCE_3D]: 'homeDistance3d',
  [FLIGHT_PARAM.CRSF_LQ_UPLINK]: 'crsfLqUplink',
  [FLIGHT_PARAM.CRSF_SNR]: 'crsfSnr',
  [FLIGHT_PARAM.GPS_VALID]: 'gpsValid',
  [FLIGHT_PARAM.LOITER_RADIUS]: 'loiterRadius',
  [FLIGHT_PARAM.ACTIVE_PROFILE]: 'activeProfile',
  [FLIGHT_PARAM.BATT_CELLS]: 'battCells',
  [FLIGHT_PARAM.AGL_STATUS]: 'aglStatus',
  [FLIGHT_PARAM.AGL]: 'agl',
  [FLIGHT_PARAM.RANGEFINDER_RAW]: 'rangefinderRaw',
  [FLIGHT_PARAM.ACTIVE_MIXER_PROFILE]: 'activeMixerProfile',
  [FLIGHT_PARAM.MIXER_TRANSITION_ACTIVE]: 'mixerTransitionActive',
  [FLIGHT_PARAM.YAW]: 'yaw',
  [FLIGHT_PARAM.FW_LAND_STATE]: 'fwLandState',
  [FLIGHT_PARAM.BATT_PROFILE]: 'battProfile',
  [FLIGHT_PARAM.FLOWN_LOITER_RADIUS]: 'flownLoiterRadius',
  [FLIGHT_PARAM.CRSF_LQ_DOWNLINK]: 'crsfLqDownlink',
  [FLIGHT_PARAM.CRSF_RSSI_DBM]: 'crsfRssiDbm',
  [FLIGHT_PARAM.MIN_GROUND_SPEED]: 'minGroundSpeed',
  [FLIGHT_PARAM.HORIZONTAL_WIND_SPEED]: 'horizontalWindSpeed',
  [FLIGHT_PARAM.WIND_DIRECTION]: 'windDirection',
  [FLIGHT_PARAM.RELATIVE_WIND_OFFSET]: 'relativeWindOffset'
};

/**
 * Human-readable names for operations
 * Used for debugging and error messages
 */
const OPERATION_NAMES = {
  [OPERATION.TRUE]: 'TRUE',
  [OPERATION.EQUAL]: 'EQUAL',
  [OPERATION.GREATER_THAN]: 'GREATER_THAN',
  [OPERATION.LOWER_THAN]: 'LOWER_THAN',
  [OPERATION.LOW]: 'LOW',
  [OPERATION.MID]: 'MID',
  [OPERATION.HIGH]: 'HIGH',
  [OPERATION.AND]: 'AND',
  [OPERATION.OR]: 'OR',
  [OPERATION.XOR]: 'XOR',
  [OPERATION.NAND]: 'NAND',
  [OPERATION.NOR]: 'NOR',
  [OPERATION.NOT]: 'NOT',
  [OPERATION.STICKY]: 'STICKY',
  [OPERATION.ADD]: 'ADD',
  [OPERATION.SUB]: 'SUB',
  [OPERATION.MUL]: 'MUL',
  [OPERATION.DIV]: 'DIV',
  [OPERATION.GVAR_SET]: 'GVAR_SET',
  [OPERATION.GVAR_INC]: 'GVAR_INC',
  [OPERATION.GVAR_DEC]: 'GVAR_DEC',
  [OPERATION.PORT_SET]: 'PORT_SET',
  [OPERATION.OVERRIDE_ARMING_SAFETY]: 'OVERRIDE_ARMING_SAFETY',
  [OPERATION.OVERRIDE_THROTTLE_SCALE]: 'OVERRIDE_THROTTLE_SCALE',
  [OPERATION.SWAP_ROLL_YAW]: 'SWAP_ROLL_YAW',
  [OPERATION.SET_VTX_POWER_LEVEL]: 'SET_VTX_POWER_LEVEL',
  [OPERATION.INVERT_ROLL]: 'INVERT_ROLL',
  [OPERATION.INVERT_PITCH]: 'INVERT_PITCH',
  [OPERATION.INVERT_YAW]: 'INVERT_YAW',
  [OPERATION.OVERRIDE_THROTTLE]: 'OVERRIDE_THROTTLE',
  [OPERATION.SET_VTX_BAND]: 'SET_VTX_BAND',
  [OPERATION.SET_VTX_CHANNEL]: 'SET_VTX_CHANNEL',
  [OPERATION.SET_OSD_LAYOUT]: 'SET_OSD_LAYOUT',
  [OPERATION.SIN]: 'SIN',
  [OPERATION.COS]: 'COS',
  [OPERATION.TAN]: 'TAN',
  [OPERATION.MAP_INPUT]: 'MAP_INPUT',
  [OPERATION.MAP_OUTPUT]: 'MAP_OUTPUT',
  [OPERATION.RC_CHANNEL_OVERRIDE]: 'RC_CHANNEL_OVERRIDE',
  [OPERATION.SET_HEADING_TARGET]: 'SET_HEADING_TARGET',
  [OPERATION.MODULUS]: 'MODULUS',
  [OPERATION.LOITER_OVERRIDE]: 'LOITER_OVERRIDE',
  [OPERATION.SET_PROFILE]: 'SET_PROFILE',
  [OPERATION.MIN]: 'MIN',
  [OPERATION.MAX]: 'MAX',
  [OPERATION.FLIGHT_AXIS_ANGLE_OVERRIDE]: 'FLIGHT_AXIS_ANGLE_OVERRIDE',
  [OPERATION.FLIGHT_AXIS_RATE_OVERRIDE]: 'FLIGHT_AXIS_RATE_OVERRIDE',
  [OPERATION.EDGE]: 'EDGE',
  [OPERATION.DELAY]: 'DELAY',
  [OPERATION.TIMER]: 'TIMER',
  [OPERATION.DELTA]: 'DELTA',
  [OPERATION.APPROX_EQUAL]: 'APPROX_EQUAL',
  [OPERATION.LED_PIN_PWM]: 'LED_PIN_PWM',
  [OPERATION.DISABLE_GPS_FIX]: 'DISABLE_GPS_FIX',
  [OPERATION.RESET_MAG_CALIBRATION]: 'RESET_MAG_CALIBRATION',
  [OPERATION.SET_GIMBAL_SENSITIVITY]: 'SET_GIMBAL_SENSITIVITY',
  [OPERATION.OVERRIDE_MIN_GROUND_SPEED]: 'OVERRIDE_MIN_GROUND_SPEED'
};

/**
 * Helper function to get flight parameter name
 * @param {number} paramId - Parameter ID
 * @returns {string} Parameter name or 'unknown'
 */
function getFlightParamName(paramId) {
  return FLIGHT_PARAM_NAMES[paramId] || `unknown_param_${paramId}`;
}

/**
 * Helper function to get operation name
 * @param {number} operationId - Operation ID
 * @returns {string} Operation name or 'unknown'
 */
function getOperationName(operationId) {
  return OPERATION_NAMES[operationId] || `unknown_operation_${operationId}`;
}

/**
 * Helper function to validate gvar index
 * @param {number} index - GVAR index
 * @returns {boolean} True if valid
 */
function isValidGvarIndex(index) {
  return index >= 0 && index < GVAR_CONFIG.COUNT;
}

/**
 * Helper function to validate RC channel
 * @param {number} channel - RC channel number
 * @returns {boolean} True if valid
 */
function isValidRCChannel(channel) {
  return channel >= RC_CHANNEL.MIN_CHANNEL && channel <= RC_CHANNEL.MAX_CHANNEL;
}

module.exports = {
  OPERAND_TYPE,
  OPERATION,
  FLIGHT_PARAM,
  FLIGHT_MODE,
  FLIGHT_PARAM_NAMES,
  OPERATION_NAMES,
  RC_CHANNEL,
  GVAR_CONFIG,
  VTX,
  
  // Helper functions
  getFlightParamName,
  getOperationName,
  isValidGvarIndex,
  isValidRCChannel
};
