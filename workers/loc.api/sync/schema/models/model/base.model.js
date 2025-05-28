'use strict'

const { cloneDeep } = require('lib-js-util-base')

const DB_SERVICE_FIELD_NAMES = require('./db.service.field.names')
const DB_DATA_TYPES = require('./db.data.types')
const COMMON_TRIGGERS = require('./common.triggers')
const COMMON_CONSTRAINTS = require('./common.constraints')

const {
  freezeAndSealObjectDeeply
} = require('../../helpers')

class BaseModel {
  static CONSTR_FIELD_NAME = DB_SERVICE_FIELD_NAMES.CONSTR_FIELD_NAME
  static TRIGGER_FIELD_NAME = DB_SERVICE_FIELD_NAMES.TRIGGER_FIELD_NAME
  static INDEX_FIELD_NAME = DB_SERVICE_FIELD_NAMES.INDEX_FIELD_NAME
  static UNIQUE_INDEX_FIELD_NAME = DB_SERVICE_FIELD_NAMES.UNIQUE_INDEX_FIELD_NAME

  static UID_FIELD_NAME = DB_SERVICE_FIELD_NAMES.UID_FIELD_NAME
  static ID_PRIMARY_KEY = DB_DATA_TYPES.ID_PRIMARY_KEY

  static BIGINT = DB_DATA_TYPES.BIGINT
  static BIGINT_NOT_NULL = DB_DATA_TYPES.BIGINT_NOT_NULL
  static INTEGER = DB_DATA_TYPES.INTEGER
  static INTEGER_NOT_NULL = DB_DATA_TYPES.INTEGER_NOT_NULL
  static DECIMAL = DB_DATA_TYPES.DECIMAL
  static DECIMAL_NOT_NULL = DB_DATA_TYPES.DECIMAL_NOT_NULL
  static VARCHAR = DB_DATA_TYPES.VARCHAR
  static VARCHAR_NOT_NULL = DB_DATA_TYPES.VARCHAR_NOT_NULL
  static TEXT = DB_DATA_TYPES.TEXT
  static TEXT_NOT_NULL = DB_DATA_TYPES.TEXT_NOT_NULL

  static ALL_DB_DATA_TYPES = Object.values(DB_DATA_TYPES)
  static ALL_DB_SERVICE_FIELD_NAMES = Object.values(DB_SERVICE_FIELD_NAMES)
    .filter((name) => name !== DB_SERVICE_FIELD_NAMES.UID_FIELD_NAME)

  static COMMON_TRIGGERS = cloneDeep(COMMON_TRIGGERS)
  static COMMON_CONSTRAINTS = cloneDeep(COMMON_CONSTRAINTS)
}

freezeAndSealObjectDeeply(
  BaseModel.ALL_DB_DATA_TYPES,
  BaseModel.ALL_DB_SERVICE_FIELD_NAMES,
  BaseModel.COMMON_TRIGGERS,
  BaseModel.COMMON_CONSTRAINTS
)
Object.freeze(BaseModel)

module.exports = BaseModel
