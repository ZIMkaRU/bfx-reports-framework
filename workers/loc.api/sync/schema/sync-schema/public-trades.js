'use strict'

const TABLES_NAMES = require('../tables-names')
const ALLOWED_COLLS = require('../allowed.colls')
const COLLS_TYPES = require('../colls.types')
const PUBLIC_COLLS_CONF_NAMES = require(
  '../../colls.accessors/public.colls.conf.names'
)

const { getModelOf } = require('../models')

module.exports = {
  name: ALLOWED_COLLS.PUBLIC_TRADES,
  maxLimit: 5000,
  dateFieldName: 'mts',
  symbolFieldName: '_symbol',
  sort: [['mts', -1]],
  hasNewData: false,
  start: [],
  confName: PUBLIC_COLLS_CONF_NAMES.PUBLIC_TRADES_CONF,
  isSyncRequiredAtLeastOnce: false,
  additionalApiCallArgs: { isNotMoreThanInnerMax: true },
  type: COLLS_TYPES.PUBLIC_INSERTABLE_ARRAY_OBJECTS,
  model: getModelOf(TABLES_NAMES.PUBLIC_TRADES)
}
